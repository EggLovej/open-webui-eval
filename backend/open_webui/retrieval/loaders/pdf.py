import datetime as dt
import io
import logging
from pathlib import Path

from langchain_core.document_loaders import BaseLoader
from langchain_core.documents import Document

log = logging.getLogger(__name__)


class PDFLoader(BaseLoader):
    def __init__(self, file_path, *, extract_images=False, mode='page'):
        if mode not in ('single', 'page'):
            raise ValueError("PDF mode must be 'single' or 'page'")
        self.file_path = str(Path(file_path).expanduser())
        self.extract_images = extract_images
        self.mode = mode
        self.ocr = None

    def lazy_load(self):
        from pypdf import PdfReader

        with open(self.file_path, 'rb') as file:
            reader = PdfReader(file)
            metadata = {'producer': 'PyPDF', 'creator': 'PyPDF', 'creationdate': ''}
            for key, value in (reader.metadata or {}).items():
                key = key.removeprefix('/').lower()
                value = value if type(value) in (str, int) else str(value)
                if key in ('creationdate', 'moddate') and isinstance(value, str):
                    try:
                        value = dt.datetime.strptime(value.replace("'", ''), 'D:%Y%m%d%H%M%S%z').isoformat()
                    except ValueError:
                        pass
                metadata[key] = (
                    value.strip()
                    if isinstance(value, str) and key not in ('creationdate', 'moddate', 'page_count', 'file_path')
                    else value
                )
            metadata.update(source=self.file_path, total_pages=len(reader.pages))
            labels = reader.page_labels if self.mode == 'page' else None
            texts = []
            for index, page in enumerate(reader.pages):
                text = page.extract_text()
                form_text = self._extract_form_fields(page)
                if form_text:
                    text = f'{text.rstrip()}\n\n{form_text}'
                if self.extract_images:
                    image_text = self._extract_images(page)
                    if image_text:
                        text = self._merge_image_text(text, image_text)
                text = text.strip()
                if self.mode == 'page':
                    yield Document(page_content=text, metadata={**metadata, 'page': index, 'page_label': labels[index]})
                else:
                    texts.append(text)
            if self.mode == 'single':
                yield Document(page_content='\n\f'.join(texts), metadata=metadata)

    @staticmethod
    def _extract_form_fields(page):
        """Filled-in form values as 'name: value' lines; extract_text() skips them.

        Read from the page's widget annotations rather than the document /AcroForm,
        which some exporters omit (e.g. D&D Beyond character sheets).
        """
        from pypdf.generic import NameObject

        annots = page.get('/Annots')
        fields = []
        for annot in annots.get_object() if annots is not None else []:
            try:
                widget = annot.get_object()
                if widget.get('/Subtype') != '/Widget':
                    continue
                # Fields with several widgets keep their name and value on the parent
                parent = widget.get('/Parent')
                parent = parent.get_object() if parent is not None else {}
                name = widget.get('/T') or parent.get('/T')
                value = widget.get('/V')
                if value is None:
                    value = parent.get('/V')
                if value is None:
                    continue

                if isinstance(value, NameObject):
                    # Checkbox/radio: a radio group keeps its choice on the shared parent,
                    # so whether this widget is the selected one comes from its own /AS
                    state = widget.get('/AS', value)
                    value = '' if state == '/Off' else 'checked'
                elif isinstance(value, bytes):
                    value = value.decode('latin-1').strip()
                elif isinstance(value, list):
                    value = ', '.join(str(v).strip() for v in value if str(v).strip())
                else:
                    value = str(value).strip()
                if not name or not value:
                    continue

                rect = [float(v) for v in widget.get('/Rect', [0, 0, 0, 0])]
                top, left = max(rect[1], rect[3]), min(rect[0], rect[2])
                fields.append((top, left, ' '.join(str(name).split()), value))
            except Exception as e:
                log.debug('Skipping unreadable PDF form field: %s', e)

        # Reading order: top to bottom, left to right, treating fields within 5pt as one row
        fields.sort(key=lambda field: (-round(field[0] / 5), field[1]))
        return '\n'.join(f'{name}: {value}' for _, _, name, value in fields)

    @staticmethod
    def _merge_image_text(text, image_text):
        # Insert before the final paragraphs/footer where possible, matching existing chunks.
        position, separator = len(text), '\n\n'
        for _ in range(2):
            for delimiter in ('\n\n\n', '\n\n'):
                found = text.rfind(delimiter, 0, position)
                if found >= 0:
                    position, separator = found, delimiter
                    break
            else:
                break
        return text[:position] + separator + image_text + text[position:]

    def _extract_images(self, page):
        import numpy as np
        from PIL import Image, UnidentifiedImageError

        if '/Resources' not in page or '/XObject' not in page['/Resources']:
            return ''
        texts = []
        xobjects = page['/Resources']['/XObject']
        for name in xobjects:
            try:
                stream = xobjects[name]
                if stream.get('/Subtype') != '/Image':
                    continue
                try:
                    # Encoded images, including CMYK JPEGs, can go straight to Pillow.
                    image = Image.open(io.BytesIO(stream.get_data()))
                except UnidentifiedImageError:
                    image = stream.decode_as_image()
                pixels = np.array(image.convert('RGB'))
            except Exception as e:
                log.warning('Skipping unreadable PDF image %s: %s', name, e)
                continue

            if self.ocr is None:
                from rapidocr import RapidOCR

                self.ocr = RapidOCR()
            result = self.ocr(pixels)
            if result and result.txts:
                texts.append('\n'.join(result.txts).strip())
        return '\n\n' + '\n'.join(filter(None, texts)) + '\n\n' if any(texts) else ''
