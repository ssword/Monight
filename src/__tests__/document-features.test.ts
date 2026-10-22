import { describe, expect, it } from 'vitest';
import { findPageTextMatches } from '../lib/document-features';

describe('document features', () => {
  it('finds every non-overlapping case-insensitive page match', () => {
    expect(findPageTextMatches('Moon light, moon night.', 'MOON', 4)).toEqual([
      expect.objectContaining({ pageNumber: 4, pageOccurrence: 0, index: 0 }),
      expect.objectContaining({ pageNumber: 4, pageOccurrence: 1, index: 12 }),
    ]);
  });
});
