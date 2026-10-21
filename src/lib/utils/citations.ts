// Each distinct chunk gets its own citation number, so an inline [n] points at one
// passage instead of a whole document. Must stay in sync with get_source_context
// in backend/open_webui/utils/middleware.py, which assigns the numbers the model sees.
export const getCitationKey = (source: any, metadata: any, document: string): string => {
	const id = metadata?.source ?? source?.source?.id ?? 'N/A';
	return `${id}\u0000${document ?? ''}`;
};

// The backend (PyPDF) and the browser (pdf.js) extract PDF text differently: line breaks,
// spacing and hyphenation vary, and words can be split ("motivati on"). Both sides drop
// these characters before matching.
const IGNORED_CHAR = /[\s­‐‑-]/;
const ANCHOR_LENGTH = 24;

const normalizedChars = (text: string, onChar: (char: string) => void) => {
	for (const char of text) {
		for (const normalized of char.normalize('NFKC')) {
			if (!IGNORED_CHAR.test(normalized)) onChar(normalized);
		}
	}
};

export const normalizeForMatch = (text: string): string => {
	let out = '';
	normalizedChars(text, (char) => (out += char));
	return out;
};

/**
 * Find a normalized passage in normalized page text. Tries an exact match first, then
 * falls back to chaining fixed-size anchors in order, so a few extraction differences
 * still locate the passage (minus the parts that differ).
 */
export const locatePassage = (haystack: string, needle: string): [number, number] | null => {
	if (!needle) return null;

	const exact = haystack.indexOf(needle);
	if (exact >= 0) return [exact, exact + needle.length];
	if (needle.length < ANCHOR_LENGTH * 2) return null;

	const offsets: number[] = [];
	for (let o = 0; o + ANCHOR_LENGTH <= needle.length; o += ANCHOR_LENGTH) offsets.push(o);
	offsets.push(needle.length - ANCHOR_LENGTH);

	let start = -1;
	let end = -1;
	let lastAt = -1;
	for (const offset of offsets) {
		const at = haystack.indexOf(needle.slice(offset, offset + ANCHOR_LENGTH), lastAt + 1);
		if (at < 0) continue;
		if (start >= 0 && at + ANCHOR_LENGTH - start > needle.length * 1.5) break;
		if (start < 0) start = at;
		end = Math.max(end, at + ANCHOR_LENGTH);
		lastAt = at;
	}

	// A lone anchor hit is too weak to trust as the passage
	return start >= 0 && end - start >= needle.length / 3 ? [start, end] : null;
};

/** DOM range covering `passage` inside the pdf.js text layers under `container`. */
export const findPassageRange = (container: HTMLElement, passage: string): Range | null => {
	const chars: Array<{ node: Text; offset: number; end: number }> = [];
	let text = '';
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let next: Node | null;
	while ((next = walker.nextNode())) {
		const node = next as Text;
		if (!node.parentElement?.closest('.textLayer')) continue;
		let offset = 0;
		for (const char of node.data) {
			normalizedChars(char, (normalized) => {
				text += normalized;
				chars.push({ node, offset, end: offset + char.length });
			});
			offset += char.length;
		}
	}

	const match = locatePassage(text, normalizeForMatch(passage));
	if (!match) return null;
	const start = chars[match[0]];
	const end = chars[match[1] - 1];
	if (!start || !end) return null;

	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.end);
	return range;
};
