<script context="module" lang="ts">
	// Selected sentences per model, claim and chunk, so reopening a citation is instant
	const sentenceCache = new Map<string, Promise<string[]>>();
</script>

<script lang="ts">
	import { getContext } from 'svelte';
	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import { getCitationHighlights } from '$lib/apis';
	import { showControls, sourceViewer, type SourceViewerState } from '$lib/stores';

	import PDFViewer from '$lib/components/common/PDFViewer.svelte';
	import TextSourceViewer from './TextSourceViewer.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	const i18n: any = getContext('i18n');

	let found: boolean | null = null;
	let sentences: string[] = [];
	let selecting = false;
	$: void showSource($sourceViewer);

	// Resets for each opened citation, then asks which sentences of the chunk back its claim.
	// Until they arrive (or if none do) the whole chunk stays highlighted.
	async function showSource(state: SourceViewerState | null) {
		found = null;
		sentences = [];
		selecting = false;
		if (!state?.claim || !state.model) return;

		const key = JSON.stringify([state.model, state.claim, state.text]);
		let request = sentenceCache.get(key);
		if (!request) {
			request = getCitationHighlights(
				localStorage.token,
				state.model,
				state.claim,
				state.text,
				state.chatId ?? undefined
			).then((res) => {
				if (!res) throw new Error('No citation highlights returned');
				return res.sentences;
			});
			sentenceCache.set(key, request);
			request.catch(() => sentenceCache.delete(key));
		}

		selecting = true;
		const result = await request.catch(() => []);
		// Another citation may have been opened in the meantime
		if ($sourceViewer !== state) return;
		sentences = result;
		selecting = false;
	}
</script>

{#if $sourceViewer}
	<div class="h-full w-full flex flex-col">
		<div
			class="pointer-events-auto z-20 flex justify-between items-center py-3 px-2 text-gray-900 dark:text-white flex-shrink-0"
		>
			<div class="flex-1 min-w-0 flex items-baseline gap-2 pl-2">
				<a
					class="truncate hover:underline"
					href={`${WEBUI_API_BASE_URL}/files/${$sourceViewer.fileId}/content`}
					target="_blank"
					rel="noopener noreferrer"
				>
					{$sourceViewer.name}
				</a>
				{#if $sourceViewer.page && $sourceViewer.format !== 'text'}
					<span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
						{$i18n.t('page')}
						{$sourceViewer.page}
					</span>
				{/if}
				{#if selecting}
					<span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">
						{$i18n.t('Finding the cited sentences…')}
					</span>
				{/if}
			</div>

			<button
				class="self-center pointer-events-auto p-1 rounded-full bg-white dark:bg-gray-850"
				aria-label={$i18n.t('Close')}
				on:click={() => {
					showControls.set(false);
					sourceViewer.set(null);
				}}
			>
				<XMark className="size-3.5 text-gray-900 dark:text-white" />
			</button>
		</div>

		{#if found === false && $sourceViewer.text}
			<div class="px-4 pb-2 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
				{$sourceViewer.format === 'text'
					? $i18n.t(
							"Couldn't locate the exact passage in the document; showing the full text instead."
						)
					: $i18n.t("Couldn't locate the exact passage in the document; showing its page instead.")}
			</div>
		{/if}

		<div class="w-full flex-1 min-h-0 relative">
			{#if $sourceViewer.format === 'text'}
				<TextSourceViewer
					fileId={$sourceViewer.fileId}
					name={$sourceViewer.name}
					highlightText={$sourceViewer.text}
					highlightSentences={sentences}
					onHighlight={(value) => (found = value)}
				/>
			{:else}
				<PDFViewer
					url={`${WEBUI_API_BASE_URL}/files/${$sourceViewer.fileId}/content`}
					className="w-full h-full"
					targetPage={$sourceViewer.page}
					highlightText={$sourceViewer.text}
					highlightSentences={sentences}
					onHighlight={(value) => (found = value)}
				/>
			{/if}
		</div>
	</div>
{/if}
