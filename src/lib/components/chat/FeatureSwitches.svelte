<script lang="ts">
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { settings } from '$lib/stores';
	import { updateUserSettings } from '$lib/apis/users';
	import { FEATURES, resolveFeatures, type FeatureId } from '$lib/utils/features';

	import Switch from '$lib/components/common/Switch.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';

	const i18n: any = getContext('i18n');

	$: features = resolveFeatures($settings?.features);

	// The whole object is sent: a UI settings update replaces the stored value of each key
	const setFeature = async (id: FeatureId, enabled: boolean) => {
		const updated = { ...features, [id]: enabled };
		settings.set({ ...$settings, features: updated });
		await updateUserSettings(localStorage.token, { ui: { features: updated } }).catch((error) =>
			toast.error(`${error}`)
		);
	};
</script>

<div class="w-full flex flex-wrap justify-center gap-x-6 gap-y-2 mb-3">
	{#each FEATURES as feature (feature.id)}
		<Tooltip content={$i18n.t(feature.description)} placement="top">
			<label
				class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer"
			>
				<Switch
					state={features[feature.id]}
					ariaLabel={$i18n.t(feature.label)}
					on:change={(e) => setFeature(feature.id, e.detail)}
				/>
				{$i18n.t(feature.label)}
			</label>
		</Tooltip>
	{/each}
</div>
