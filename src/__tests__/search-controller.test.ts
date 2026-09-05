import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchController } from '../app/search-controller';
import type { PdfSearchMatch, SearchProgress } from '../lib/document-features';
import type { DocumentPresentation } from '../reader/document-access';
import type { DocumentQuery } from '../reader/document-queries';

class SearchElement {
  value = '';
  textContent = '';
  disabled = false;
  private hidden = true;
  private readonly listeners = new Map<string, EventListener>();
  readonly classList = {
    add: vi.fn((name: string) => {
      if (name === 'hidden') this.hidden = true;
    }),
    remove: vi.fn((name: string) => {
      if (name === 'hidden') this.hidden = false;
    }),
    contains: vi.fn((name: string) => name === 'hidden' && this.hidden),
  };

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  trigger(type: string): void {
    this.listeners.get(type)?.(new Event(type));
  }

  focus(): void {}

  select(): void {}
}

function createSearchControls(): Map<string, SearchElement> {
  return new Map(
    [
      'search-bar',
      'search-input',
      'search-status',
      'search-previous',
      'search-next',
      'search-close',
      'open-search',
    ].map((id) => [id, new SearchElement()]),
  );
}

function match(pageNumber: number, pageOccurrence: number): PdfSearchMatch {
  return {
    pageNumber,
    pageOccurrence,
    index: pageOccurrence,
    excerpt: `match on page ${pageNumber}`,
  };
}

function progress(
  pageNumber: number,
  totalPages: number,
  matches: PdfSearchMatch[],
): SearchProgress {
  return {
    pageNumber,
    totalPages,
    pageMatches: matches,
    matches,
  };
}

function activeDocument(viewer: {
  searchText: unknown;
  revealSearchMatch: (match: PdfSearchMatch) => Promise<void>;
  clearSearch: () => void;
}) {
  const searchText = viewer.searchText as (
    query: string,
    onProgress?: (event: SearchProgress) => void,
  ) => Promise<PdfSearchMatch[]>;
  const query = {
    filePath: '/docs/test.pdf',
    generation: 1,
    isCurrent: () => true,
    search: (value: string, options?: { onProgress?: (event: SearchProgress) => void }) =>
      searchText(value, options?.onProgress),
  } as unknown as DocumentQuery;
  const presentation = {
    revealSearchMatch: viewer.revealSearchMatch,
    clearSearch: viewer.clearSearch,
    setSearchQuery: vi.fn(),
  } as unknown as DocumentPresentation;
  return { query, presentation };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SearchController', () => {
  it('does not restart an active scan when navigation is requested before page progress', async () => {
    const controls = createSearchControls();
    vi.stubGlobal('document', {
      getElementById: (id: string) => controls.get(id) ?? null,
    });

    let finishSearch: ((matches: PdfSearchMatch[]) => void) | undefined;
    const viewer = {
      searchText: vi.fn(async () => {
        return new Promise<PdfSearchMatch[]>((resolve) => {
          finishSearch = resolve;
        });
      }),
      revealSearchMatch: vi.fn(async () => {}),
      clearSearch: vi.fn(),
    };
    const current = activeDocument(viewer);
    const controller = new SearchController(() => current);
    const input = controls.get('search-input');
    const nextButton = controls.get('search-next');
    if (!input || !nextButton) throw new Error('Search controls not created');

    input.value = 'moon';
    controller.open();
    await vi.waitFor(() => expect(viewer.searchText).toHaveBeenCalledOnce());

    nextButton.trigger('click');
    await Promise.resolve();
    expect(viewer.searchText).toHaveBeenCalledOnce();

    finishSearch?.([]);
  });

  it('shows partial results and navigates before scanning finishes', async () => {
    const controls = createSearchControls();
    vi.stubGlobal('document', {
      getElementById: (id: string) => controls.get(id) ?? null,
    });

    const first = match(2, 0);
    const second = match(3, 0);
    let emitProgress: ((event: SearchProgress) => void) | undefined;
    let finishSearch: ((matches: PdfSearchMatch[]) => void) | undefined;
    const viewer = {
      searchText: vi.fn(async (_query: string, onProgress: (event: SearchProgress) => void) => {
        emitProgress = onProgress;
        return new Promise<PdfSearchMatch[]>((resolve) => {
          finishSearch = resolve;
        });
      }),
      revealSearchMatch: vi.fn(async () => {}),
      clearSearch: vi.fn(),
    };
    const current = activeDocument(viewer);
    const controller = new SearchController(() => current);
    const input = controls.get('search-input');
    const nextButton = controls.get('search-next');
    const status = controls.get('search-status');
    if (!input || !nextButton || !status) throw new Error('Search controls not created');

    input.value = 'moon';
    controller.open();
    await vi.waitFor(() => expect(viewer.searchText).toHaveBeenCalledOnce());

    emitProgress?.(progress(1, 3, []));
    expect(status.textContent).toBe('0 matches · scanning 1/3');
    expect(nextButton.disabled).toBe(true);

    emitProgress?.(progress(2, 3, [first]));
    expect(status.textContent).toBe('1 match · scanning 2/3');
    expect(nextButton.disabled).toBe(false);
    expect(viewer.revealSearchMatch).not.toHaveBeenCalled();

    emitProgress?.(progress(3, 3, [first, second]));
    expect(status.textContent).toBe('2 matches · scanning 3/3');
    nextButton.trigger('click');
    await vi.waitFor(() => expect(viewer.revealSearchMatch).toHaveBeenCalledWith(first));

    finishSearch?.([first, second]);
    await vi.waitFor(() => expect(status.textContent).toBe('1 of 2 · page 2'));
  });

  it('applies mid-scan navigation in request order', async () => {
    const controls = createSearchControls();
    vi.stubGlobal('document', {
      getElementById: (id: string) => controls.get(id) ?? null,
    });

    const first = match(1, 0);
    const second = match(2, 0);
    let emitProgress: ((event: SearchProgress) => void) | undefined;
    let finishSearch: ((matches: PdfSearchMatch[]) => void) | undefined;
    const finishReveals: Array<() => void> = [];
    const viewer = {
      searchText: vi.fn(async (_query: string, onProgress: (event: SearchProgress) => void) => {
        emitProgress = onProgress;
        return new Promise<PdfSearchMatch[]>((resolve) => {
          finishSearch = resolve;
        });
      }),
      revealSearchMatch: vi.fn(
        async () =>
          new Promise<void>((resolve) => {
            finishReveals.push(resolve);
          }),
      ),
      clearSearch: vi.fn(),
    };
    const current = activeDocument(viewer);
    const controller = new SearchController(() => current);
    const input = controls.get('search-input');
    const nextButton = controls.get('search-next');
    const status = controls.get('search-status');
    if (!input || !nextButton || !status) throw new Error('Search controls not created');

    input.value = 'moon';
    controller.open();
    await vi.waitFor(() => expect(viewer.searchText).toHaveBeenCalledOnce());
    emitProgress?.(progress(2, 3, [first, second]));

    nextButton.trigger('click');
    await vi.waitFor(() => expect(viewer.revealSearchMatch).toHaveBeenCalledTimes(1));
    nextButton.trigger('click');
    expect(viewer.revealSearchMatch).toHaveBeenCalledTimes(1);
    expect(viewer.revealSearchMatch).toHaveBeenNthCalledWith(1, first);

    finishReveals[0]?.();
    await vi.waitFor(() => expect(viewer.revealSearchMatch).toHaveBeenCalledTimes(2));
    expect(viewer.revealSearchMatch).toHaveBeenNthCalledWith(2, second);

    finishReveals[1]?.();
    finishSearch?.([first, second]);
    await vi.waitFor(() => expect(status.textContent).toBe('2 of 2 · page 2'));
  });

  it('does not apply progress emitted after search is closed', async () => {
    const controls = createSearchControls();
    vi.stubGlobal('document', {
      getElementById: (id: string) => controls.get(id) ?? null,
    });

    let emitProgress: ((event: SearchProgress) => void) | undefined;
    let finishSearch: ((matches: PdfSearchMatch[]) => void) | undefined;
    const viewer = {
      searchText: vi.fn(async (_query: string, onProgress: (event: SearchProgress) => void) => {
        emitProgress = onProgress;
        return new Promise<PdfSearchMatch[]>((resolve) => {
          finishSearch = resolve;
        });
      }),
      revealSearchMatch: vi.fn(async () => {}),
      clearSearch: vi.fn(),
    };
    const current = activeDocument(viewer);
    const controller = new SearchController(() => current);
    const input = controls.get('search-input');
    const closeButton = controls.get('search-close');
    const status = controls.get('search-status');
    if (!input || !closeButton || !status) throw new Error('Search controls not created');

    input.value = 'moon';
    controller.open();
    await vi.waitFor(() => expect(viewer.searchText).toHaveBeenCalledOnce());

    closeButton.trigger('click');
    emitProgress?.(progress(1, 3, [match(1, 0)]));
    finishSearch?.([]);
    await Promise.resolve();

    expect(status.textContent).toBe('Type to search');
    expect(viewer.revealSearchMatch).not.toHaveBeenCalled();
    expect(viewer.clearSearch).toHaveBeenCalledOnce();
  });

  it('cancels partial results when the query changes', async () => {
    vi.useFakeTimers();
    const controls = createSearchControls();
    vi.stubGlobal('document', {
      getElementById: (id: string) => controls.get(id) ?? null,
    });
    vi.stubGlobal('window', globalThis);

    const progressCallbacks: Array<(event: SearchProgress) => void> = [];
    const finishSearches: Array<(matches: PdfSearchMatch[]) => void> = [];
    const viewer = {
      searchText: vi.fn(async (_query: string, onProgress: (event: SearchProgress) => void) => {
        progressCallbacks.push(onProgress);
        return new Promise<PdfSearchMatch[]>((resolve) => {
          finishSearches.push(resolve);
        });
      }),
      revealSearchMatch: vi.fn(async () => {}),
      clearSearch: vi.fn(),
    };
    const current = activeDocument(viewer);
    const controller = new SearchController(() => current);
    const input = controls.get('search-input');
    const nextButton = controls.get('search-next');
    const status = controls.get('search-status');
    if (!input || !nextButton || !status) throw new Error('Search controls not created');

    input.value = 'moon';
    controller.open();
    expect(viewer.searchText).toHaveBeenCalledOnce();

    progressCallbacks[0]?.(progress(1, 3, [match(1, 0)]));
    expect(status.textContent).toBe('1 match · scanning 1/3');

    input.value = 'sun';
    input.trigger('input');
    expect(status.textContent).toBe('Searching…');
    expect(nextButton.disabled).toBe(true);

    progressCallbacks[0]?.(progress(2, 3, [match(1, 0), match(2, 0)]));
    expect(status.textContent).toBe('Searching…');

    await vi.advanceTimersByTimeAsync(180);
    expect(viewer.searchText).toHaveBeenNthCalledWith(2, 'sun', expect.any(Function));

    finishSearches[0]?.([]);
    finishSearches[1]?.([]);
    controller.close();
  });
});
