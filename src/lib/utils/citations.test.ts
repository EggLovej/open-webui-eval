import { describe, expect, it } from 'vitest';
import {
	formFieldsFromAnnotations,
	getCitationKey,
	getSegments,
	locateLines,
	locatePassage,
	matchFormFields,
	mergeLineBoxes,
	normalizeForMatch,
	parseSegmentRange,
	resolveSegments,
	stripLineNumbers
} from './citations';

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

describe('stripLineNumbers', () => {
	it('removes line-number prefixes from tool output', () => {
		expect(stripLineNumbers('160: STR: 18\n161: DEX: 16\n')).toBe('STR: 18\nDEX: 16\n');
	});

	it('leaves normal text alone', () => {
		const text = 'Eq Name11: Fragment\nEq Qty11: 1\n12: not a numbered block';
		expect(stripLineNumbers(text)).toBe(text);
	});
});

describe('formFieldsFromAnnotations', () => {
	const widget = (extra: object) => ({ subtype: 'Widget', rect: [0, 0, 10, 10], ...extra });

	it('reads text, checkbox, radio and list values like the backend loader', () => {
		const fields = formFieldsFromAnnotations([
			widget({ fieldName: 'STR', fieldValue: ' 18 ' }),
			widget({ fieldName: 'StrProf', checkBox: true, fieldValue: 'Yes' }),
			widget({ fieldName: 'Unticked', checkBox: true, fieldValue: 'Off' }),
			widget({ fieldName: 'Align', radioButton: true, fieldValue: 'Good', buttonValue: 'Good' }),
			widget({ fieldName: 'Align', radioButton: true, fieldValue: 'Good', buttonValue: 'Evil' }),
			widget({ fieldName: 'Langs', fieldValue: ['Common', 'Draconic'] }),
			widget({ fieldName: 'parent.Kid', fieldValue: 'x' }),
			widget({ fieldName: 'Empty', fieldValue: '' }),
			{ subtype: 'Link', rect: [0, 0, 1, 1] }
		]);
		expect(fields.map((f) => `${f.name}: ${f.value}`)).toEqual([
			'STR: 18',
			'StrProf: checked',
			'Align: checked',
			'Langs: Common, Draconic',
			'Kid: x'
		]);
	});
});

describe('matchFormFields', () => {
	const field = (name: string, value: string) => ({ name, value, rect: [0, 0, 1, 1] });
	const fields = [
		field('STR', '18'),
		field('DEX', '16'),
		field('Eq Qty1', '1'),
		field('Features', 'Second Wind\nYou have a limited well of stamina.\nAction Surge recharges.')
	];

	it('matches fields by their "name: value" line and returns the remaining text', () => {
		const { matched, rest } = matchFormFields('STRENGTH\nSTR: 18\nDEX: 16\nSKILLS', fields);
		expect(matched.map((f) => f.name)).toEqual(['STR', 'DEX']);
		expect(rest).toBe('STRENGTH\nSKILLS');
	});

	it('does not match a field whose value differs or whose name is only a prefix', () => {
		expect(matchFormFields('Eq Qty11: 1\nSTR: 180', fields).matched).toEqual([]);
	});

	it('matches a multi-line value even when the chunk starts mid-value', () => {
		const chunk = 'You have a limited well of stamina.\nAction Surge recharges.\nDEX: 16';
		expect(matchFormFields(chunk, fields).matched.map((f) => f.name)).toEqual(['DEX', 'Features']);
	});
});

describe('locateLines', () => {
	it('matches lines in order, merges adjacent ones and skips short lines', () => {
		const page = normalizeForMatch('CHARACTER NAME EXPERIENCE POINTS STRENGTH SKILLS');
		const lines = ['CHARACTER NAME', 'EXPERIENCE POINTS', 'AC', 'SKILLS', 'NOT ON PAGE'].map(
			normalizeForMatch
		);
		expect(locateLines(page, lines)).toEqual([
			[0, 29],
			[37, 43]
		]);
	});
});

describe('segments', () => {
	const chunk = 'STRENGTH\n\nSTR: 18\n   \nDEX: 16\n\fAC: 16';

	it('numbers non-blank lines from 1, skipping blank and whitespace-only lines', () => {
		expect(getSegments(chunk)).toEqual(['STRENGTH', 'STR: 18', 'DEX: 16', '\fAC: 16']);
	});

	it('parses single segments, ranges and ranges that repeat the source id', () => {
		expect(parseSegmentRange('3')).toEqual([3, 3]);
		expect(parseSegmentRange('3-5')).toEqual([3, 5]);
		expect(parseSegmentRange('3-2#5')).toEqual([3, 5]);
		expect(parseSegmentRange('5-3')).toBeNull();
		expect(parseSegmentRange('0')).toBeNull();
		expect(parseSegmentRange('abc')).toBeNull();
	});

	it('resolves a citation suffix to the cited segments', () => {
		expect(resolveSegments(chunk, '2')).toBe('STR: 18');
		expect(resolveSegments(chunk, '2-3')).toBe('STR: 18\nDEX: 16');
		expect(resolveSegments(chunk, '9')).toBeNull();
		expect(resolveSegments(chunk, null)).toBeNull();
	});

	it('resolves tool-result line numbers instead of segment positions', () => {
		const tool =
			'165: Passive1: 14\n166: Wpn Name: Adamantine Longsword, +1\n167: Wpn1 AtkBonus: +7';
		expect(resolveSegments(tool, '166-167')).toBe(
			'Wpn Name: Adamantine Longsword, +1\nWpn1 AtkBonus: +7'
		);
		expect(resolveSegments(tool, '2')).toBeNull();
	});
});

describe('mergeLineBoxes', () => {
	const box = (left: number, top: number, width: number, height = 12) => ({
		left,
		top,
		width,
		height
	});

	it('joins the word spans of a justified line into one box', () => {
		expect(mergeLineBoxes([box(0, 0, 40), box(52, 0.5, 30), box(95, 0, 60)])).toEqual([
			{ left: 0, top: 0, width: 155, height: 12.5 }
		]);
	});

	it('keeps separate lines separate', () => {
		expect(mergeLineBoxes([box(0, 0, 100), box(0, 14, 80)])).toHaveLength(2);
	});

	it('does not bridge a column gutter', () => {
		expect(mergeLineBoxes([box(0, 0, 200), box(240, 0, 200)])).toHaveLength(2);
	});
});
