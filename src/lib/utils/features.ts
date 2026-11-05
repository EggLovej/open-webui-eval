// Switchable features of this fork, so each can be evaluated on its own and in combination.
// A switch is stored in three places that must agree: the user's settings ($settings.features),
// the chat request (form_data.features, read by backend/open_webui/utils/features.py) and the
// reply it produced (message.features), so a reply renders the way it was generated even after
// the switch changes. Label and description are i18n keys; add their translations by hand, the
// i18n parser does not see keys that are not literals in a $i18n.t() call.
export const FEATURES = [
	{
		id: 'enrichedReferences',
		requestKey: 'enriched_references',
		default: true,
		label: 'Enriched references',
		description:
			'Cite single passages and lines, and open sources next to the chat. Applies to new replies.'
	}
] as const;

export type FeatureId = (typeof FEATURES)[number]['id'];
export type Features = Record<FeatureId, boolean>;

/** Every switch resolved to a boolean; missing or unknown values fall back to the default. */
export const resolveFeatures = (features?: Partial<Record<string, unknown>> | null): Features =>
	Object.fromEntries(
		FEATURES.map((feature) => {
			const value = features?.[feature.id];
			return [feature.id, typeof value === 'boolean' ? value : feature.default];
		})
	) as Features;

/** The switches as the backend reads them from form_data.features. */
export const toRequestFeatures = (features: Features): Record<string, boolean> =>
	Object.fromEntries(FEATURES.map((feature) => [feature.requestKey, features[feature.id]]));
