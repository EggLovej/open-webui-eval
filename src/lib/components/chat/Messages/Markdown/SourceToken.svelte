<script lang="ts">
	import { LinkPreview } from 'bits-ui';
	import { decodeString } from '$lib/utils';
	import { getCitationClaim } from '$lib/utils/citations';
	import Source from './Source.svelte';

	export let id;
	export let token;
	export let sourceIds = [];
	export let onClick: Function = () => {};

	let containerElement;
	let openPreview = false;

	// Also report the sentence this marker cites. Read from the marker in the message,
	// since the buttons of a multi-source popover render outside it.
	const onSourceClick = (identifier) =>
		onClick(identifier, containerElement ? getCitationClaim(containerElement) : '');

	// Helper function to return only the domain from a URL
	function getDomain(url: string): string {
		const domain = url.replace('http://', '').replace('https://', '').split(/[/?#]/)[0];

		if (domain.startsWith('www.')) {
			return domain.slice(4);
		}
		return domain;
	}

	// Helper function to check if text is a URL and return the domain
	function formattedTitle(title: string): string {
		if (title.startsWith('http')) {
			return getDomain(title);
		}

		return title;
	}

	const getDisplayTitle = (title: string) => {
		if (!title) return 'N/A';
		if (title.length > 30) {
			return title.slice(0, 15) + '...' + title.slice(-10);
		}
		return title;
	};
</script>

{#if sourceIds}
	<span class="contents" data-citation-marker bind:this={containerElement}>
		{#if (token?.ids ?? []).length == 1}
			{@const id = token.ids[0]}
			{@const identifier = token.citationIdentifiers ? token.citationIdentifiers[0] : id - 1}
			<Source id={identifier} title={sourceIds[id - 1]} onClick={onSourceClick} />
		{:else}
			<LinkPreview.Root openDelay={0} bind:open={openPreview}>
				<LinkPreview.Trigger>
					<button
						aria-label={`${getDisplayTitle(formattedTitle(decodeString(sourceIds[token.ids[0] - 1])))} +${(token?.ids ?? []).length - 1} more sources`}
						class="text-[0.625rem] w-fit translate-y-[2px] px-2 py-0.5 dark:bg-white/5 dark:text-white/80 dark:hover:text-white bg-gray-50 text-black/80 hover:text-black transition rounded-xl"
						on:click={() => {
							openPreview = !openPreview;
						}}
					>
						<span class="line-clamp-1">
							{getDisplayTitle(formattedTitle(decodeString(sourceIds[token.ids[0] - 1])))}
							<span class="dark:text-white/50 text-black/50">+{(token?.ids ?? []).length - 1}</span>
						</span>
					</button>
				</LinkPreview.Trigger>
				<LinkPreview.Portal>
					<LinkPreview.Content class="z-[999]" align="start" strategy="fixed" sideOffset={6}>
						<div class="bg-gray-50 dark:bg-gray-850 rounded-xl p-1 cursor-pointer">
							{#each token.citationIdentifiers ?? token.ids as identifier}
								{@const id =
									typeof identifier === 'string' ? parseInt(identifier.split('#')[0]) : identifier}
								<div class="">
									<Source id={identifier} title={sourceIds[id - 1]} onClick={onSourceClick} />
								</div>
							{/each}
						</div>
					</LinkPreview.Content>
				</LinkPreview.Portal>
			</LinkPreview.Root>
		{/if}
	</span>
{:else}
	<span>{token.raw}</span>
{/if}
