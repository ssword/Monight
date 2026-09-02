import { describe, expect, it, vi } from 'vitest';
import {
  findPageTextMatches,
  type PdfSearchMatch,
  type SearchProgress,
  searchDocumentIncrementally,
} from '../lib/document-features';

const pages = [
  'moon over the water',
  'nothing to see here',
  'moon and moon again',
  'final page without a hit',
  'one last moon',
];

function fullScan(query: string): PdfSearchMatch[] {
  return pages.flatMap((pageText, index) => findPageTextMatches(pageText, query, index + 1));
}

describe('searchDocumentIncrementally', () => {
  it('emits matches once per page in document order', async () => {
    const progress: SearchProgress[] = [];

    const matches = await searchDocumentIncrementally({
      query: 'moon',
      totalPages: pages.length,
      getPageText: async (pageNumber) => pages[pageNumber - 1] ?? '',
      isCancelled: () => false,
      onProgress: (event) => progress.push(event),
    });

    expect(progress.map((event) => event.pageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(progress.map((event) => event.pageMatches.length)).toEqual([1, 0, 2, 0, 1]);
    expect(progress.map((event) => event.matches.length)).toEqual([1, 1, 3, 3, 4]);
    expect(matches).toHaveLength(4);
  });

  it('returns the same ordered results as the previous full-scan behavior', async () => {
    const matches = await searchDocumentIncrementally({
      query: 'moon',
      totalPages: pages.length,
      getPageText: async (pageNumber) => pages[pageNumber - 1] ?? '',
      isCancelled: () => false,
    });

    expect(matches).toEqual(fullScan('moon'));
  });

  it('stops scanning and discards results when the query token is cancelled', async () => {
    const progress: SearchProgress[] = [];
    const getPageText = vi.fn(async (pageNumber: number) => pages[pageNumber - 1] ?? '');
    let cancelled = false;

    const matches = await searchDocumentIncrementally({
      query: 'moon',
      totalPages: pages.length,
      getPageText,
      isCancelled: () => cancelled,
      onProgress: (event) => {
        progress.push(event);
        if (event.pageNumber === 2) cancelled = true;
      },
    });

    expect(progress.map((event) => event.pageNumber)).toEqual([1, 2]);
    expect(getPageText).toHaveBeenCalledTimes(2);
    expect(matches).toEqual([]);
  });

  it('does not emit a page after cancellation during its text read', async () => {
    let cancelled = false;
    const onProgress = vi.fn();

    const matches = await searchDocumentIncrementally({
      query: 'moon',
      totalPages: pages.length,
      getPageText: async (pageNumber) => {
        cancelled = true;
        return pages[pageNumber - 1] ?? '';
      },
      isCancelled: () => cancelled,
      onProgress,
    });

    expect(onProgress).not.toHaveBeenCalled();
    expect(matches).toEqual([]);
  });

  it('gives progress consumers snapshots they cannot mutate', async () => {
    const progress: SearchProgress[] = [];

    const matches = await searchDocumentIncrementally({
      query: 'moon',
      totalPages: pages.length,
      getPageText: async (pageNumber) => pages[pageNumber - 1] ?? '',
      isCancelled: () => false,
      onProgress: (event) => {
        progress.push(event);
        event.matches.length = 0;
        event.pageMatches.length = 0;
      },
    });

    expect(matches).toEqual(fullScan('moon'));
  });
});
