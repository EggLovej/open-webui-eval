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
 * Spans of normalized `sentences` within haystack[start, end), searched in order so a
 * repeated short sentence resolves to the occurrence after the previous one. Sentences
 * that cannot be found are left out.
 */
export const locateSentences = (
	haystack: string,
	[start, end]: [number, number],
	sentences: string[]
): Array<[number, number]> => {
	const region = haystack.slice(start, end);
	const spans: Array<[number, number]> = [];
	let from = 0;
	for (const sentence of sentences) {
		const after = locatePassage(region.slice(from), sentence);
		const match = after ? [after[0] + from, after[1] + from] : locatePassage(region, sentence);
		if (!match) continue;
		spans.push([start + match[0], start + match[1]]);
		from = match[1];
	}
	return spans;
};

type TextIndex = { text: string; chars: Array<{ node: Text; offset: number; end: number }> };

// Normalized text mapped back to DOM positions; PDF callers limit it to text layers.
const indexTextLayers = (container: HTMLElement, selector: string | null): TextIndex => {
	const index: TextIndex = { text: '', chars: [] };
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let next: Node | null;
	while ((next = walker.nextNode())) {
		const node = next as Text;
		if (selector && !node.parentElement?.closest(selector)) continue;
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

const toRange = ({ chars }: TextIndex, [from, to]: [number, number]): Range | null => {
	const start = chars[from];
	const end = chars[to - 1];
	if (!start || !end) return null;

	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.end);
	return range;
};

/**
 * DOM ranges covering `passage` and each of `sentences` within it. By default only
 * PDF text layers are indexed; pass null for an ordinary rendered text container.
 */
export const findPassageRanges = (
	container: HTMLElement,
	passage: string,
	sentences: string[] = [],
	selector: string | null = '.textLayer'
): { passage: Range; sentences: Range[] } | null => {
	const index = indexTextLayers(container, selector);
	const match = locatePassage(index.text, normalizeForMatch(passage));
	const passageRange = match && toRange(index, match);
	if (!match || !passageRange) return null;

	return {
		passage: passageRange,
		sentences: locateSentences(index.text, match, sentences.map(normalizeForMatch))
			.map((span) => toRange(index, span))
			.filter((range): range is Range => range !== null)
	};
};

// A sentence-ending mark, with any closing quotes or brackets, before whitespace or the end
const SENTENCE_END = /[.!?…。！？]["'”’)\]]*(?=\s|$)/g;

// Positions just after each sentence end in `text`. A full stop before a lowercase word or a
// digit ("e.g. the", "Fig. 1a") is not an end; split_sentences on the backend agrees.
const sentenceEnds = (text: string): number[] =>
	Array.from(text.matchAll(SENTENCE_END), (match) => match.index! + match[0].length).filter(
		(end) => !/^\s*[\p{Ll}\d]/u.test(text.slice(end))
	);

/**
 * The sentence an inline citation backs, from the text before and after its marker
 * (with other citation labels already left out). A marker placed after the full stop
 * ("... lying time. [1]") cites the sentence before it.
 */
export const claimAround = (before: string, after: string): string => {
	const head = before.trimEnd();
	const ends = sentenceEnds(head);
	const closed = ends.at(-1) === head.length;
	const start = ends.filter((end) => end < head.length).at(-1) ?? 0;
	const tail = closed ? '' : after.slice(0, sentenceEnds(after)[0] ?? after.length);
	return (head.slice(start) + tail)
		.replace(/\s+/g, ' ')
		.replace(/\s+([.,;:!?])/g, '$1')
		.trim();
};

// Set on inline citations by SourceToken.svelte
const CITATION_MARKER = '[data-citation-marker]';
const CLAIM_BLOCK = 'p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6';

/** The claim an inline citation marker backs: its sentence, without citation labels. */
export const getCitationClaim = (marker: Element): string => {
	const block = marker.closest(CLAIM_BLOCK) ?? marker.parentElement;
	if (!block) return '';

	let before = '';
	let after = '';
	const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	let next: Node | null;
	while ((next = walker.nextNode())) {
		const node = next as Text;
		if (node.parentElement?.closest(CITATION_MARKER)) continue;
		if (marker.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) {
			before += node.data;
		} else {
			after += node.data;
		}
	}
	return claimAround(before, after);
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

export type Box = { left: number; top: number; width: number; height: number };

/**
 * Join the rects of a highlighted range into one box per visual line. pdf.js puts each
 * text run in its own span, so justified text leaves the spaces between words uncovered.
 * Only boxes that share a line and sit within about a line height of each other merge,
 * so a highlight spanning two columns does not bridge the gutter.
 */
export const mergeLineBoxes = (boxes: Box[]): Box[] => {
	const merged: Box[] = [];
	// Left to right, so each line grows rightwards even when its spans' tops differ slightly
	const sorted = [...boxes].sort((a, b) => a.left - b.left || a.top - b.top);
	for (const box of sorted) {
		const line = merged.find((other) => {
			const overlap =
				Math.min(other.top + other.height, box.top + box.height) - Math.max(other.top, box.top);
			const gap = Math.max(
				box.left - (other.left + other.width),
				other.left - (box.left + box.width),
				0
			);
			return (
				overlap >= Math.min(other.height, box.height) / 2 &&
				gap <= Math.max(other.height, box.height) * 1.5
			);
		});
		if (!line) {
			merged.push({ ...box });
			continue;
		}
		const right = Math.max(line.left + line.width, box.left + box.width);
		const bottom = Math.max(line.top + line.height, box.top + box.height);
		line.left = Math.min(line.left, box.left);
		line.top = Math.min(line.top, box.top);
		line.width = right - line.left;
		line.height = bottom - line.top;
	}
	return merged;
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
		const index = indexTextLayers(page, '.textLayer');
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
