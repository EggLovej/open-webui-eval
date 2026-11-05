import { describe, expect, it } from 'vitest';
import { FEATURES, resolveFeatures, toRequestFeatures } from './features';

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
