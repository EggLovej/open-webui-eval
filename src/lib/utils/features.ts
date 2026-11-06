// Switchable features of this fork, so each can be evaluated on its own and in combination.
// A switch is stored in three places that must agree: the user's settings ($settings.features),
// the chat request (form_data.features, read by backend/open_webui/utils/features.py) and the
// reply it produced (message.meta.features, in request shape), so a reply renders the way it
// was generated even after the switch changes. Label and description are i18n keys; add their
// translations by hand, the i18n parser does not see keys that are not literals in $i18n.t().
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

/** Our switches read back from a request-shaped features object; other keys are ignored. */
export const fromRequestFeatures = (request: unknown): Partial<Features> | undefined => {
	if (!request || typeof request !== 'object') return undefined;
	const entries = FEATURES.filter((feature) => feature.requestKey in request).map((feature) => [
		feature.id,
		(request as Record<string, unknown>)[feature.requestKey]
	]);
	return Object.fromEntries(entries) as Partial<Features>;
};

/**
 * The switches a reply was generated with, or undefined for a reply that has none recorded.
 * They live in message.meta.features because a stored reply keeps only known fields, and
 * meta is the one free-form field among them (backend/open_webui/models/chat_messages.py).
 * The backend writes the request's features to the same place when it pauses a reply.
 */
export const featuresOfMessage = (message: any): Partial<Features> | undefined =>
	fromRequestFeatures(message?.meta?.features);
