import { describe, expect, it } from 'vitest';
import { getCitationKey, locatePassage, normalizeForMatch } from './citations';

describe('getCitationKey', () => {
	const source = { source: { id: 'file-1', name: 'paper.pdf' } };

	it('gives different chunks of the same file different keys', () => {
		const meta = { source: 'paper.pdf' };
		expect(getCitationKey(source, meta, 'chunk A')).not.toBe(
			getCitationKey(source, meta, 'chunk B')
		);
	});

	it('gives a repeated chunk the same key', () => {
		const meta = { source: 'paper.pdf', start_index: 0 };
		expect(getCitationKey(source, meta, 'chunk A')).toBe(
			getCitationKey(source, { ...meta }, 'chunk A')
		);
	});

	it('keeps identical text from different files apart', () => {
		expect(getCitationKey(source, { source: 'a.pdf' }, 'same')).not.toBe(
			getCitationKey(source, { source: 'b.pdf' }, 'same')
		);
	});

	it('falls back to the source id when chunk metadata has no source', () => {
		expect(getCitationKey(source, undefined, 'x')).toBe(getCitationKey(source, {}, 'x'));
	});
});

describe('locatePassage', () => {
	const page = normalizeForMatch(
		'Introduction text. The probability of cows standing up increased linearly with lying time (Fig. 1a), as hypothesized. The probability of cows lying down was, however, entirely unaffected by standing time. Discussion follows.'
	);

	it('finds an exact passage', () => {
		const needle = normalizeForMatch('The probability of cows standing up increased linearly');
		const match = locatePassage(page, needle);
		expect(match).not.toBeNull();
		expect(page.slice(...match!)).toBe(needle);
	});

	it('ignores whitespace, line breaks and hyphenation differences between extractors', () => {
		const pdfjs = normalizeForMatch('This suggests that the increase in motivati on to lie down');
		const pypdf = normalizeForMatch('This suggests that the in-\ncrease in motivation to lie down');
		expect(locatePassage(pdfjs, pypdf)).toEqual([0, pdfjs.length]);
	});

	it('normalizes ligatures', () => {
		expect(normalizeForMatch('signiﬁcant')).toBe('significant');
	});

	it('falls back to anchors when part of the passage differs', () => {
		const needle = normalizeForMatch(
			'093 HEADER JUNK The probability of cows standing up increased linearly with lying time (Fig. 1a), as hypothesized.'
		);
		const match = locatePassage(page, needle);
		expect(match).not.toBeNull();
		expect(page.slice(...match!)).toContain(
			normalizeForMatch('increased linearly with lying time')
		);
		expect(page.slice(...match!)).not.toContain('Introduction');
	});

	it('returns null for text that is not on the page', () => {
		const needle = normalizeForMatch(
			'Completely unrelated sentence about milk yield and feeding schedules in winter barns.'
		);
		expect(locatePassage(page, needle)).toBeNull();
	});
});
