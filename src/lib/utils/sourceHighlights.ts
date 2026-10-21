import { findPassageRanges } from './citations';

/** Wrap text rather than overlay rectangles, so highlights follow wrapping and resizing. */
export function highlightSource(
	container: HTMLElement,
	passage: string,
	sentences: string[]
): HTMLElement | null {
	const ranges = findPassageRanges(container, passage, sentences, null);
	if (!ranges) return null;
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	let next: Node | null;
	while ((next = walker.nextNode())) nodes.push(next as Text);
	let first: HTMLElement | null = null;
	const plans = nodes.map((node) => {
		const spans = [ranges.passage, ...ranges.sentences].flatMap((range, index) => {
			if (!range.intersectsNode(node)) return [];
			const start = range.startContainer === node ? range.startOffset : 0;
			const end = range.endContainer === node ? range.endOffset : node.length;
			return end > start ? [{ start, end, strong: index > 0 || !ranges.sentences.length }] : [];
		});
		return { node, spans };
	});
	for (const { node, spans } of plans) {
		if (!spans.length) continue;
		const cuts = [...new Set([0, node.length, ...spans.flatMap((s) => [s.start, s.end])])].sort(
			(a, b) => a - b
		);
		const fragment = document.createDocumentFragment();
		for (let i = 1; i < cuts.length; i++) {
			const start = cuts[i - 1];
			const end = cuts[i];
			const text = node.data.slice(start, end);
			const covering = spans.filter((s) => s.start <= start && s.end >= end);
			if (!covering.length) {
				fragment.append(text);
				continue;
			}
			const mark = document.createElement('mark');
			mark.className = covering.some((s) => s.strong) ? 'source-highlight' : 'source-context';
			mark.textContent = text;
			first ??= mark;
			fragment.append(mark);
		}
		node.replaceWith(fragment);
	}
	return first;
}
