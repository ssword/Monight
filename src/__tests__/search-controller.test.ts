import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchController } from '../app/search-controller';
import type { PdfSearchMatch, SearchProgress } from '../lib/document-features';
import type { PDFViewer } from '../scripts/pdf-viewer';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SearchController', () => {
  it('shows partial results and navigates before scanning finishes', async () => {
    const controls = createSearchControls();
    vi.stubGlobal('document', {
      getElementById: (id: string) => controls.get(id) ?? null,
    });

    const first = match(1, 0);
    const second = match(2, 0);
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
    } as unknown as PDFViewer;
    const controller = new SearchController(() => viewer);
    const input = controls.get('search-input');
    const nextButton = controls.get('search-next');
    const status = controls.get('search-status');
    if (!input || !nextButton || !status) throw new Error('Search controls not created');

    input.value = 'moon';
    controller.open();
    await vi.waitFor(() => expect(viewer.searchText).toHaveBeenCalledOnce());

    emitProgress?.(progress(1, 3, [first]));
    expect(status.textContent).toBe('1 of 1 · page 1 · scanning 1/3');
    expect(nextButton.disabled).toBe(false);

    emitProgress?.(progress(2, 3, [first, second]));
    nextButton.trigger('click');
    await vi.waitFor(() => expect(viewer.revealSearchMatch).toHaveBeenCalledWith(second));

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
    } as unknown as PDFViewer;
    const controller = new SearchController(() => viewer);
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
});
