// Bookmarks sidebar mode: the active Document's Bookmarks in page order, each
// with a thumbnail and page label. Activating one goes to its page as a recorded
// jump (Navigation History); the remove button deletes it from the Bookmark
// store. The list is re-read from the store on every sidebar refresh and
// rebuilt only when it changes.

import type { DocumentQuery } from '../reader/document-queries';
import type {
  SidebarDocument,
  SidebarItem,
  SidebarModeContext,
  SidebarModeView,
} from './reader-sidebar';

const THUMBNAIL_INSET = 40;

export function createBookmarksView({
  dispatchReaderAction,
  whenVisible,
  width,
  bookmarks,
  itemsChanged,
}: SidebarModeContext): SidebarModeView {
  const element = document.createElement('div');
  element.className = 'sidebar-bookmarks';
  element.setAttribute('role', 'region');
  element.setAttribute('aria-label', 'Bookmarks');
  let shown: { filePath: string; signature: string } | null = null;
  let pages: number[] = [];
  let selectedKey: string | null = null;
  let latest: SidebarDocument | null = null;
  let cancels: Array<() => void> = [];
  let generation = 0;

  const clear = () => {
    for (const cancel of cancels) cancel();
    cancels = [];
    generation += 1;
  };

  const markSelected = () => {
    for (const row of element.querySelectorAll<HTMLElement>('.sidebar-bookmark')) {
      if (row.dataset.page === selectedKey) {
        row.setAttribute('aria-current', 'true');
        row.scrollIntoView?.({ block: 'nearest' });
      } else {
        row.removeAttribute('aria-current');
      }
    }
  };

  const activate = async (page: number) => {
    if (!shown) return;
    const { filePath } = shown;
    selectedKey = String(page);
    markSelected();
    itemsChanged();
    await dispatchReaderAction({ type: 'goToPage', page, filePath, recordHistory: true });
  };

  const renderThumbnail = (query: DocumentQuery, page: number, image: HTMLElement) => {
    const buildGeneration = generation;
    const maxWidth = Math.round(
      Math.max(1, width() - THUMBNAIL_INSET) * (window.devicePixelRatio || 1),
    );
    void query
      .thumbnail(page, { maxWidth })
      .then((canvas) => {
        if (generation !== buildGeneration || !query.isCurrent()) return;
        image.replaceChildren(canvas);
        image.classList.add('rendered');
      })
      .catch((error: unknown) => {
        if (generation === buildGeneration) console.error('Bookmark thumbnail failed:', error);
      });
  };

  const renderRow = (page: number, query: DocumentQuery | null): HTMLLIElement => {
    const item = document.createElement('li');
    item.className = 'sidebar-bookmark-item';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sidebar-bookmark';
    row.dataset.page = String(page);
    row.setAttribute('aria-label', `Bookmark, page ${page}`);
    const image = document.createElement('span');
    image.className = 'sidebar-bookmark-image sidebar-thumbnail-image';
    const label = document.createElement('span');
    label.className = 'sidebar-bookmark-label';
    label.textContent = `Page ${page}`;
    row.append(image, label);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'sidebar-bookmark-remove';
    remove.dataset.page = String(page);
    remove.textContent = '×';
    remove.title = 'Remove Bookmark';
    remove.setAttribute('aria-label', `Remove Bookmark on page ${page}`);
    item.append(row, remove);
    if (query) cancels.push(whenVisible(row, () => renderThumbnail(query, page, image)));
    return item;
  };

  const render = (sidebarDocument: SidebarDocument) => {
    const { filePath, pageCount, query } = sidebarDocument;
    const nextPages = bookmarks()?.pages(filePath, pageCount) ?? [];
    const signature = `${query?.generation}:${nextPages.join(',')}`;
    if (shown?.filePath === filePath && shown.signature === signature) return;
    if (shown?.filePath !== filePath) selectedKey = null;
    shown = { filePath, signature };
    pages = nextPages;
    if (!pages.some((page) => String(page) === selectedKey)) selectedKey = null;
    clear();
    itemsChanged();
    if (pages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sidebar-bookmarks-empty';
      empty.textContent = 'No Bookmarks. Choose Tools ▸ Add Bookmark to mark the current page.';
      element.replaceChildren(empty);
      return;
    }
    const list = document.createElement('ol');
    list.className = 'sidebar-bookmark-list';
    list.append(...pages.map((page) => renderRow(page, query)));
    element.replaceChildren(list);
    markSelected();
  };

  element.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const remove = target?.closest<HTMLElement>('.sidebar-bookmark-remove');
    if (remove) {
      const page = Number(remove.dataset.page);
      if (shown && Number.isInteger(page)) {
        bookmarks()?.toggle(shown.filePath, page);
        if (latest) render(latest);
      }
      return;
    }
    const row = target?.closest<HTMLElement>('.sidebar-bookmark');
    const page = Number(row?.dataset.page);
    if (Number.isInteger(page) && page >= 1) void activate(page);
  });

  return {
    element,
    update(sidebarDocument) {
      latest = sidebarDocument;
      if (!sidebarDocument) {
        shown = null;
        pages = [];
        selectedKey = null;
        clear();
        element.replaceChildren();
        itemsChanged();
        return;
      }
      render(sidebarDocument);
    },
    items: (): SidebarItem[] =>
      pages.map((page) => ({
        key: String(page),
        page,
        activate: () => activate(page),
      })),
    selectedItemKey: () => selectedKey,
    destroy() {
      clear();
      element.replaceChildren();
      shown = null;
    },
  };
}
