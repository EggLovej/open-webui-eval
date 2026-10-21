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

/**
 * Line-by-line fallback for text that is not one contiguous run on the page (e.g. form
 * labels interleaved with other content). Lines are matched in order; short lines are
 * skipped since they match all over a page.
 */
export const locateLines = (
	haystack: string,
	lines: string[],
	minLength = 6
): [number, number][] => {
	const spans: [number, number][] = [];
	let from = 0;
	for (const line of lines) {
		if (line.length < minLength) continue;
		const at = haystack.indexOf(line, from);
		if (at < 0) continue;
		const last = spans[spans.length - 1];
		if (last && last[1] === at) last[1] = at + line.length;
		else spans.push([at, at + line.length]);
		from = at + line.length;
	}
	return spans;
};

// Same blank-line rule as label_segments in backend/open_webui/utils/middleware.py; an
// explicit set, since JS trim() and Python strip() disagree on some Unicode whitespace.
const SEGMENT_BLANK_LINE = /^[ \t\r\f\v]*$/;

/** A chunk's segments, numbered from 1 like the [2#3] labels the model saw. */
export const getSegments = (text: string): string[] =>
	text.split('\n').filter((line) => !SEGMENT_BLANK_LINE.test(line));

/** "3", "3-5" or "3-2#5" (models sometimes repeat the source id) to [start, end]. */
export const parseSegmentRange = (suffix: string): [number, number] | null => {
	const match = /^(\d+)(?:-(?:\d+#)?(\d+))?$/.exec(suffix.trim());
	if (!match) return null;
	const start = Number(match[1]);
	const end = match[2] ? Number(match[2]) : start;
	return start >= 1 && end >= start ? [start, end] : null;
};

/**
 * The text a [id#suffix] citation points at, or null if it does not resolve (the caller
 * then falls back to the whole chunk). Chunks are numbered by segment; tool results
 * already carry line numbers ("166: ..."), which the model cites directly.
 */
export const resolveSegments = (text: string, suffix: string | null): string | null => {
	const range = suffix ? parseSegmentRange(suffix) : null;
	if (!range) return null;
	const [start, end] = range;

	if (stripLineNumbers(text) !== text) {
		const picked = text.split('\n').filter((line) => {
			const number = /^(\d+): /.exec(line);
			return number && Number(number[1]) >= start && Number(number[1]) <= end;
		});
		return picked.length ? picked.map((line) => line.replace(/^\d+: /, '')).join('\n') : null;
	}

	const picked = getSegments(text).slice(start - 1, end);
	return picked.length ? picked.join('\n') : null;
};

/** Tool results (e.g. view_knowledge_file) prefix every line with its line number. */
export const stripLineNumbers = (text: string): string => {
	const lines = text.split('\n');
	const nonEmpty = lines.filter((line) => line.trim());
	const numbered = nonEmpty.filter((line) => /^\d+: /.test(line));
	if (nonEmpty.length === 0 || numbered.length / nonEmpty.length < 0.8) return text;
	return lines.map((line) => line.replace(/^\d+: /, '')).join('\n');
};

export type PdfFormField = { name: string; value: string; rect: number[] };

/** Filled-in values from pdf.js page annotations, in the shape the backend writes them. */
export const formFieldsFromAnnotations = (annotations: any[]): PdfFormField[] =>
	annotations.flatMap((a) => {
		if (a.subtype !== 'Widget' || !a.fieldName || !Array.isArray(a.rect)) return [];
		let value = '';
		if (a.checkBox) value = a.fieldValue && a.fieldValue !== 'Off' ? 'checked' : '';
		else if (a.radioButton) value = a.fieldValue === a.buttonValue ? 'checked' : '';
		else if (Array.isArray(a.fieldValue)) value = a.fieldValue.join(', ');
		else if (typeof a.fieldValue === 'string') value = a.fieldValue;
		value = value.trim();
		// pdf.js gives the full "parent.child" name; the backend writes the widget's own name
		const name = String(a.fieldName).split('.').pop() ?? '';
		return value && name ? [{ name, value, rect: a.rect }] : [];
	});

/**
 * Which form fields a cited text contains, matched against the "name: value" lines the
 * backend PDF loader writes for them (backend/open_webui/retrieval/loaders/pdf.py).
 * Also returns the cited text without those lines, to match against the page text.
 */
export const matchFormFields = (
	text: string,
	fields: PdfFormField[]
): { matched: PdfFormField[]; rest: string } => {
	const lines = text.split('\n').map(normalizeForMatch);
	const lineSet = new Set(lines);
	const covered = new Set<string>();
	const matched = fields.filter((field) => {
		const fieldLines = `${field.name}: ${field.value}`.split('\n').map(normalizeForMatch);
		// A long multi-line value may be split across chunks, so its first line can be missing
		const hit =
			lineSet.has(fieldLines[0]) ||
			fieldLines.slice(1).filter((line) => line.length >= 8 && lineSet.has(line)).length >= 2;
		if (hit) fieldLines.forEach((line) => covered.add(line));
		return hit;
	});
	const rest = text
		.split('\n')
		.filter((_, i) => !covered.has(lines[i]))
		.join('\n');
	return { matched, rest };
};

type TextLayerIndex = {
	text: string;
	chars: Array<{ node: Text; offset: number; end: number }>;
};

const indexTextLayer = (container: HTMLElement): TextLayerIndex => {
	const index: TextLayerIndex = { text: '', chars: [] };
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let next: Node | null;
	while ((next = walker.nextNode())) {
		const node = next as Text;
		if (!node.parentElement?.closest('.textLayer')) continue;
		let offset = 0;
		for (const char of node.data) {
			normalizedChars(char, (normalized) => {
				index.text += normalized;
				index.chars.push({ node, offset, end: offset + char.length });
			});
			offset += char.length;
		}
	}
	return index;
};

const toRange = (index: TextLayerIndex, [startAt, endAt]: [number, number]): Range | null => {
	const start = index.chars[startAt];
	const end = index.chars[endAt - 1];
	if (!start || !end) return null;
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.end);
	return range;
};

export type PageMatch = {
	ranges: Range[];
	fields: PdfFormField[];
	// The text was found as one passage rather than as scattered lines
	contiguous: boolean;
	// Matched characters (normalized), for comparing pages
	score: number;
};

/** Where cited text appears on one rendered PDF page: text-layer ranges and form fields. */
export const locateOnPage = (
	page: HTMLElement,
	text: string,
	fields: PdfFormField[]
): PageMatch => {
	const { matched, rest } = matchFormFields(text, fields);
	const result: PageMatch = { ranges: [], fields: matched, contiguous: false, score: 0 };
	for (const field of matched)
		result.score += normalizeForMatch(`${field.name}:${field.value}`).length;

	const needle = normalizeForMatch(rest);
	if (needle) {
		const index = indexTextLayer(page);
		const whole = locatePassage(index.text, needle);
		const spans = whole
			? [whole]
			: locateLines(index.text, rest.split('\n').map(normalizeForMatch));
		result.contiguous = !!whole;
		for (const span of spans) {
			const range = toRange(index, span);
			if (!range) continue;
			result.ranges.push(range);
			result.score += span[1] - span[0];
		}
	}
	return result;
};
