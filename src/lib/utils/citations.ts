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
