// The sidebar's search takeover view: results for the toolbar Search field,
// grouped by page with surrounding context. It is transient presentation, never
// a persisted sidebar mode. Activating a result is a Reader Action
// (`activateDocumentTarget`), so Navigation History can record the jump.

import type { PdfSearchMatch } from '../lib/document-features';
import type { DispatchReaderAction } from '../reader/reader-actions';
import type { SidebarDocument } from './reader-sidebar';

export interface SearchResultsView {
  readonly element: HTMLElement;
  /** Searches the Document for `text`, replacing any earlier results. */
  show(document: SidebarDocument | null, text: string): void;
  destroy(): void;
}

function excerptWithMark(excerpt: string, text: string): Node[] {
  const needle = text.trim().toLocaleLowerCase();
  const start = needle ? excerpt.toLocaleLowerCase().indexOf(needle) : -1;
  if (start < 0) return [document.createTextNode(excerpt)];
  const mark = document.createElement('mark');
  mark.textContent = excerpt.slice(start, start + needle.length);
  return [
    document.createTextNode(excerpt.slice(0, start)),
    mark,
    document.createTextNode(excerpt.slice(start + needle.length)),
  ];
}

export function createSearchResultsView(
  dispatchReaderAction: DispatchReaderAction,
): SearchResultsView {
  const element = document.createElement('div');
  element.className = 'sidebar-search';
  const status = document.createElement('p');
  status.className = 'search-status';
  status.setAttribute('aria-live', 'polite');
  const list = document.createElement('ol');
  list.className = 'search-results';
  list.setAttribute('aria-label', 'Search results');
  element.append(status, list);

  let shown: { filePath: string; generation: number | undefined; text: string } | null = null;
  let token = 0;
  let matches: readonly PdfSearchMatch[] = [];

  const render = (text: string, found: readonly PdfSearchMatch[], done: boolean) => {
    matches = found;
    const groups = new Map<number, Array<{ match: PdfSearchMatch; index: number }>>();
    found.forEach((match, index) => {
      const group = groups.get(match.pageNumber) ?? [];
      group.push({ match, index });
      groups.set(match.pageNumber, group);
    });
    const pages = [...groups.entries()].map(([pageNumber, hits]) => {
      const item = document.createElement('li');
      item.className = 'search-result-group';
      const heading = document.createElement('h3');
      heading.className = 'search-result-page';
      heading.textContent = `Page ${pageNumber}`;
      const hitList = document.createElement('ol');
      for (const { match, index } of hits) {
        const hitItem = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-result';
        button.dataset.match = String(index);
        button.append(...excerptWithMark(match.excerpt, text));
        hitItem.append(button);
        hitList.append(hitItem);
      }
      item.append(heading, hitList);
      return item;
    });
    list.replaceChildren(...pages);
    const count = found.length;
    status.textContent = !done
      ? 'Searching…'
      : count === 0
        ? 'No results'
        : `${count} ${count === 1 ? 'result' : 'results'}`;
  };

  list.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element ? event.target.closest<HTMLElement>('.search-result') : null;
    const match = matches[Number(button?.dataset.match)];
    if (!shown || !match) return;
    void dispatchReaderAction({
      type: 'activateDocumentTarget',
      filePath: shown.filePath,
      target: {
        readingPosition: { page: match.pageNumber, location: match.location ?? 0 },
      },
    });
  });

  const clear = () => {
    token += 1;
    shown = null;
    matches = [];
    list.replaceChildren();
    status.textContent = '';
  };

  return {
    element,
    show(sidebarDocument, text) {
      const query = sidebarDocument?.query ?? null;
      if (!sidebarDocument || !query || !text.trim()) {
        clear();
        return;
      }
      const next = { filePath: sidebarDocument.filePath, generation: query.generation, text };
      if (
        shown &&
        shown.filePath === next.filePath &&
        shown.generation === next.generation &&
        shown.text === next.text
      ) {
        return;
      }
      clear();
      shown = next;
      const searchToken = token;
      const isCancelled = () => searchToken !== token;
      render(text, [], false);
      void query
        .search(text, {
          isCancelled,
          onProgress: (progress) => {
            if (!isCancelled()) render(text, progress.matches, false);
          },
        })
        .then((found) => {
          if (!isCancelled()) render(text, found, true);
        })
        .catch((error: unknown) => {
          if (isCancelled()) return;
          console.error('Search failed:', error);
          render(text, [], true);
        });
    },
    destroy: clear,
  };
}
