import { describe, expect, it } from 'vitest';
import { findPageTextMatches, nextViewMode, updateRecentFiles } from '../lib/document-features';

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

  it('moves an opened file to the front and keeps the list bounded', () => {
    const recent = [
      { filePath: '/a.pdf', title: 'a.pdf', openedAt: 1 },
      { filePath: '/b.pdf', title: 'b.pdf', openedAt: 2 },
    ];

    expect(
      updateRecentFiles(recent, { filePath: '/b.pdf', title: 'B.pdf', openedAt: 3 }, 2),
    ).toEqual([
      { filePath: '/b.pdf', title: 'B.pdf', openedAt: 3 },
      { filePath: '/a.pdf', title: 'a.pdf', openedAt: 1 },
    ]);
  });
});
