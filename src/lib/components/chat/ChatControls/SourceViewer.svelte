<script lang="ts">
	import { getContext } from 'svelte';
	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import { showControls, sourceViewer, type SourceViewerState } from '$lib/stores';

	import PDFViewer from '$lib/components/common/PDFViewer.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	const i18n: any = getContext('i18n');

	let found: boolean | null = null;
	$: resetFound($sourceViewer);

	// Takes the state only so Svelte re-runs this when a different citation is opened
	function resetFound(_state: SourceViewerState | null) {
		found = null;
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
				{#if $sourceViewer.page}
					<span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
						{$i18n.t('page')}
						{$sourceViewer.page}
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

		{#if found === false}
			<div class="px-4 pb-2 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
				{$i18n.t("Couldn't locate the exact passage in the document; showing its page instead.")}
			</div>
		{/if}

		<div class="w-full flex-1 min-h-0 relative">
			<PDFViewer
				url={`${WEBUI_API_BASE_URL}/files/${$sourceViewer.fileId}/content`}
				className="w-full h-full"
				targetPage={$sourceViewer.page}
				highlightText={$sourceViewer.text}
				onHighlight={(value) => (found = value)}
			/>
		</div>
	</div>
{/if}
