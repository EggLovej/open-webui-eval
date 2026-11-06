import { describe, expect, it } from 'vitest';
import {
	FEATURES,
	featuresOfMessage,
	fromRequestFeatures,
	resolveFeatures,
	toRequestFeatures
} from './features';

describe('resolveFeatures', () => {
	it('uses the defaults when nothing is stored', () => {
		expect(resolveFeatures(undefined)).toEqual({ enrichedReferences: true });
		expect(resolveFeatures(null)).toEqual(resolveFeatures({}));
	});

	it('keeps a stored switch', () => {
		expect(resolveFeatures({ enrichedReferences: false }).enrichedReferences).toBe(false);
	});

	it('ignores unknown keys and non-boolean values', () => {
		const resolved = resolveFeatures({ enrichedReferences: 'no', other: true });
		expect(resolved).toEqual({ enrichedReferences: true });
	});
});

describe('toRequestFeatures', () => {
	it('maps every switch to its request key', () => {
		const request = toRequestFeatures(resolveFeatures({ enrichedReferences: false }));
		expect(request).toEqual({ enriched_references: false });
		expect(Object.keys(request)).toHaveLength(FEATURES.length);
	});
});

describe('fromRequestFeatures', () => {
	it('reads our switches back and ignores other request features', () => {
		expect(fromRequestFeatures({ enriched_references: false, web_search: true })).toEqual({
			enrichedReferences: false
		});
	});

	it('round-trips with toRequestFeatures', () => {
		const features = resolveFeatures({ enrichedReferences: false });
		expect(resolveFeatures(fromRequestFeatures(toRequestFeatures(features)))).toEqual(features);
	});

	it('is undefined for a missing object and empty for one without our keys', () => {
		expect(fromRequestFeatures(undefined)).toBeUndefined();
		expect(fromRequestFeatures({ web_search: true })).toEqual({});
	});
});

describe('featuresOfMessage', () => {
	it('reads the reply switches from meta', () => {
		const message = { meta: { features: { enriched_references: false } } };
		expect(resolveFeatures(featuresOfMessage(message)).enrichedReferences).toBe(false);
	});

	it('leaves a reply without a record to the defaults', () => {
		expect(featuresOfMessage({ content: 'x' })).toBeUndefined();
		expect(featuresOfMessage({ features: { enrichedReferences: false } })).toBeUndefined();
		expect(resolveFeatures(featuresOfMessage(undefined)).enrichedReferences).toBe(true);
	});
});
