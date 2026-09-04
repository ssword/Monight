import { describe, expect, it } from 'vitest';
import { findPageTextMatches, nextViewMode } from '../lib/document-features';

describe('document features', () => {
  it('cycles through single, continuous, and spread layouts', () => {
    expect(nextViewMode('single')).toBe('continuous');
    expect(nextViewMode('continuous')).toBe('spread');
    expect(nextViewMode('spread')).toBe('single');
  });

  it('finds every non-overlapping case-insensitive page match', () => {
    expect(findPageTextMatches('Moon light, moon night.', 'MOON', 4)).toEqual([
      expect.objectContaining({ pageNumber: 4, pageOccurrence: 0, index: 0 }),
      expect.objectContaining({ pageNumber: 4, pageOccurrence: 1, index: 12 }),
    ]);
  });
});
