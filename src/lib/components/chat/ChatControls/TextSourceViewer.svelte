<script lang="ts">
	import { getContext, onDestroy, tick } from 'svelte';
	import { Marked } from 'marked';
	import DOMPurify from 'dompurify';
	import hljs from 'highlight.js';
	import { getFileIndexedText } from '$lib/apis/files';
	import { highlightSource } from '$lib/utils/sourceHighlights';
	import Spinner from '$lib/components/common/Spinner.svelte';

	export let fileId: string;
	export let name: string;
	export let highlightText = '';
	export let highlightSentences: string[] = [];
	export let onHighlight: (found: boolean) => void = () => {};

	const i18n: any = getContext('i18n');
	let container: HTMLDivElement;
	let content = '';
	let loading = true;
	let unavailable = false;
	let controller: AbortController;
	let renderVersion = 0;
	const markdown = new Marked({ breaks: true });
	const renderMarkdown = (text: string) =>
		DOMPurify.sanitize(markdown.parse(text, { async: false }) as string, {
			USE_PROFILES: { html: true },
			FORBID_TAGS: ['img', 'iframe', 'style', 'form', 'input', 'video', 'audio'],
			FORBID_ATTR: ['style', 'id', 'name']
		});

	$: void load(fileId);
	$: void render(
		container,
		content.trim() ? content : highlightText,
		name,
		highlightText,
		highlightSentences,
		loading
	);

	async function load(id: string) {
		controller?.abort();
		const request = new AbortController();
		controller = request;
		loading = true;
		content = '';
		unavailable = false;
		try {
			const text = await getFileIndexedText(localStorage.token, id, request.signal);
			if (request.signal.aborted) return;
			content = text;
			unavailable = !text.trim();
		} catch {
			if (request.signal.aborted) return;
			unavailable = true;
		} finally {
			if (!request.signal.aborted) loading = false;
		}
	}

	async function render(
		element: HTMLDivElement,
		text: string,
		filename: string,
		passage: string,
		sentences: string[],
		pending: boolean
	) {
		const version = ++renderVersion;
		if (!element || pending) return;
		const ext = filename.split('.').pop()?.toLowerCase() ?? '';
		const isMarkdown = ['md', 'markdown'].includes(ext);
		element.classList.toggle('source-markdown', isMarkdown);
		if (isMarkdown) {
			// Sources are untrusted: do not load remote images or embed active content.
			element.innerHTML = renderMarkdown(text);
			for (const link of element.querySelectorAll('a')) {
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
			}
		} else {
			element.textContent = text;
			const language = ext === 'py' ? 'python' : ext;
			if (hljs.getLanguage(language)) {
				element.innerHTML = hljs.highlight(text, { language, ignoreIllegals: true }).value;
			}
		}
		let target = highlightSource(element, passage, sentences);
		if (!target && isMarkdown && passage) {
			const renderedText = (source: string) => {
				const fragment = document.createElement('div');
				fragment.innerHTML = renderMarkdown(source);
				return fragment.textContent ?? '';
			};
			target = highlightSource(element, renderedText(passage), sentences.map(renderedText));
		}
		if (!target && isMarkdown && passage) {
			// Citation chunks may include Markdown syntax that is absent in the rendered text.
			element.classList.remove('source-markdown');
			element.textContent = text;
			target = highlightSource(element, passage, sentences);
		}
		onHighlight(Boolean(target));
		await tick();
		if (version !== renderVersion) return;
		if (target) target.scrollIntoView({ block: 'center' });
		else element.parentElement?.scrollTo({ top: 0 });
	}

	onDestroy(() => {
		controller?.abort();
		renderVersion++;
	});
</script>

<div class="h-full overflow-auto bg-gray-50 dark:bg-gray-900 rounded-lg" aria-busy={loading}>
	{#if loading}
		<div class="flex justify-center p-8"><Spinner /></div>
	{/if}
	{#if !loading && unavailable}
		<p class="px-5 pt-4 text-sm text-gray-500" role="status">
			{highlightText
				? $i18n.t('The full document could not be loaded. Showing the cited passage.')
				: $i18n.t('The document text could not be loaded.')}
		</p>
	{/if}
	<div
		bind:this={container}
		class="source-text p-5 text-sm text-gray-900 dark:text-gray-100"
		hidden={loading}
	></div>
</div>

<style>
	.source-text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-family: monospace;
		line-height: 1.7;
		tab-size: 4;
	}
	.source-text:global(.source-markdown) {
		white-space: normal;
		font-family: inherit;
	}
	.source-text :global(pre) {
		white-space: pre-wrap;
	}
	.source-text :global(p),
	.source-text :global(pre) {
		margin-bottom: 1em;
	}
	.source-text :global(h1),
	.source-text :global(h2),
	.source-text :global(h3) {
		font-weight: 700;
		font-size: 1.25em;
		margin: 1em 0 0.5em;
	}
	.source-text :global(ul),
	.source-text :global(ol) {
		padding-left: 1.5em;
		list-style: revert;
	}
	.source-text :global(a) {
		text-decoration: underline;
	}
	.source-text :global(mark) {
		color: #052e16;
		border-radius: 2px;
	}
	.source-text :global(.source-highlight) {
		background: #90ee90;
	}
	.source-text :global(.source-context) {
		background: #d8f8d8;
	}
	.source-text :global(.hljs-keyword),
	.source-text :global(.hljs-built_in) {
		color: #a855f7;
	}
	.source-text :global(.hljs-string),
	.source-text :global(.hljs-title) {
		color: #0d9488;
	}
	.source-text :global(.hljs-comment) {
		color: #737373;
	}
	.source-text :global(.hljs-number),
	.source-text :global(.hljs-literal) {
		color: #d97706;
	}
</style>
