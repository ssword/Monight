// Monight's reader sidebar: a toolbar toggle plus a mode dropdown over one
// resizable panel. Visibility, mode and width are chrome preferences shared by
// every Document; nothing here reaches the Reading Session. Page navigation
// goes through Reader Actions.
//
// Extending: add a mode to SIDEBAR_MODES (chrome-preferences.ts), a
// `[data-sidebar-mode]` menu item, and a SidebarModeView factory in
// MODE_VIEWS. Transient presentation (e.g. a search takeover) belongs in
// `presentation()`, layered over the persisted preferences without writing them.
// The search takeover (sidebar-search.ts) is one such layer: while the toolbar
// Search field has text the sidebar shows results; clearing it falls back to
// the untouched preferences.

import type { DocumentQuery } from '../reader/document-queries';
import type { DispatchReaderAction } from '../reader/reader-actions';
import { buildFilterCSS, type FilterSettings } from '../scripts/filters';
import {
  type ChromePreferencesAuthority,
  SIDEBAR_MODES,
  SIDEBAR_WIDTH_BOUNDS,
  type SidebarMode,
} from './chrome-preferences';
import { createAnnotationsView } from './sidebar-annotations-view';
import { createSearchResultsView, type SearchResultsView } from './sidebar-search';
import { createTableOfContentsView } from './sidebar-table-of-contents';

/** What the sidebar needs to know about the active Document. */
/** A sidebar choice offered by the toolbar's mode dropdown and the View menu. */
export type SidebarChoice = SidebarMode | 'hidden';

export interface SidebarDocument {
  readonly filePath: string;
  readonly pageCount: number;
  readonly currentPage: number;
  readonly filterSettings: FilterSettings;
  readonly query: DocumentQuery | null;
}

/** Defers work until an element scrolls into view; returns a cancel function. */
export type WhenVisible = (element: Element, show: () => void) => () => void;

export interface SidebarModeContext {
  readonly dispatchReaderAction: DispatchReaderAction;
  readonly whenVisible: WhenVisible;
  readonly width: () => number;
  /** Selects an Annotation on the rendering surface; transient, never Reading Session state. */
  readonly revealAnnotation: RevealAnnotation;
}

export type RevealAnnotation = (filePath: string, annotationId: string) => void;

export interface SidebarModeView {
  readonly element: HTMLElement;
  /** Called whenever the active Document or its rendering state may have changed. */
  update(document: SidebarDocument | null): void;
  destroy(): void;
}

export interface ReaderSidebarElements {
  readonly root: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly modeToggle: HTMLButtonElement;
  readonly modeMenu: HTMLElement;
  /** The toolbar Search field; typing in it takes over the sidebar. */
  readonly search?: HTMLInputElement;
}

export interface ReaderSidebarOptions {
  readonly elements: ReaderSidebarElements;
  readonly preferences: ChromePreferencesAuthority;
  readonly activeDocument: () => SidebarDocument | null;
  readonly dispatchReaderAction: DispatchReaderAction;
  readonly whenVisible?: WhenVisible;
  readonly searchDebounceMs?: number;
  readonly revealAnnotation?: RevealAnnotation;
}

export interface ReaderSidebar {
  /** Re-reads the active Document; call on Reading Session and rendering changes. */
  refresh(): void;
  /** Hides the sidebar or shows a mode, as the mode dropdown does; ends a search takeover. */
  choose(choice: SidebarChoice): void;
  /** Focuses the toolbar Search field (Find). */
  focusSearch(): void;
  destroy(): void;
}

const SEARCH_DEBOUNCE_MS = 150;
const RESIZE_STEP = 10;
const THUMBNAIL_INSET = 40;

const MODE_VIEWS: Readonly<Record<SidebarMode, (context: SidebarModeContext) => SidebarModeView>> =
  {
    thumbnails: createThumbnailsView,
    tableOfContents: createTableOfContentsView,
    annotations: createAnnotationsView,
  };

function observeVisibility(root: Element | null): WhenVisible {
  return (element, show) => {
    if (typeof IntersectionObserver === 'undefined') {
      show();
      return () => undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          show();
        }
      },
      { root, rootMargin: '200px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  };
}

export function createReaderSidebar({
  elements: { root, toggle, modeToggle, modeMenu, search },
  preferences,
  activeDocument,
  dispatchReaderAction,
  whenVisible,
  searchDebounceMs = SEARCH_DEBOUNCE_MS,
  revealAnnotation = () => undefined,
}: ReaderSidebarOptions): ReaderSidebar {
  const content = root.querySelector<HTMLElement>('.reader-sidebar-content') ?? root;
  const resizer = root.querySelector<HTMLElement>('.reader-sidebar-resizer');
  const context: SidebarModeContext = {
    dispatchReaderAction,
    whenVisible: whenVisible ?? observeVisibility(content),
    width: () => preferences.snapshot().sidebarWidth,
    revealAnnotation,
  };
  let view: { mode: SidebarMode; view: SidebarModeView } | null = null;
  // Transient search takeover: never written to preferences.
  let searchText = '';
  let searchView: SearchResultsView | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) => {
    target.addEventListener(type, listener as EventListener);
    cleanups.push(() => target.removeEventListener(type, listener as EventListener));
  };

  /** Effective presentation: the search takeover layered over the preferences. */
  const presentation = (): { visible: boolean; mode: SidebarMode | 'search'; width: number } => {
    const { sidebarVisible, sidebarMode, sidebarWidth } = preferences.snapshot();
    if (searchText.trim()) return { visible: true, mode: 'search', width: sidebarWidth };
    return { visible: sidebarVisible, mode: sidebarMode, width: sidebarWidth };
  };

  const applyWidth = (width: number) => {
    root.style.width = `${width}px`;
    resizer?.setAttribute('aria-valuenow', String(width));
  };

  const render = () => {
    const { visible, mode, width } = presentation();
    root.hidden = !visible;
    root.dataset.sidebarMode = mode;
    applyWidth(width);
    toggle.setAttribute('aria-pressed', String(visible));
    for (const item of modeMenu.querySelectorAll<HTMLElement>('[data-sidebar-mode]')) {
      const itemMode = item.dataset.sidebarMode;
      item.setAttribute(
        'aria-checked',
        String(visible ? itemMode === mode : itemMode === 'hidden'),
      );
    }
    if (mode !== 'search') searchView?.destroy();
    if (!visible || mode === 'search') {
      view?.view.destroy();
      view = null;
    }
    if (!visible) return;
    if (mode === 'search') {
      searchView ??= createSearchResultsView(dispatchReaderAction);
      if (content.firstElementChild !== searchView.element) {
        content.replaceChildren(searchView.element);
      }
      searchView.show(activeDocument(), searchText);
      return;
    }
    if (view?.mode !== mode) {
      view?.view.destroy();
      view = { mode, view: MODE_VIEWS[mode](context) };
      content.replaceChildren(view.view.element);
    }
    view.view.update(activeDocument());
  };

  const menuOpen = () => !modeMenu.classList.contains('hidden');
  const setMenuOpen = (open: boolean) => {
    modeMenu.classList.toggle('hidden', !open);
    modeToggle.setAttribute('aria-expanded', String(open));
  };

  const cancelSearchTimer = () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
  };
  /** Ends the takeover without touching preferences; returns whether one was active. */
  const endSearch = () => {
    cancelSearchTimer();
    const wasActive = Boolean(searchText.trim());
    searchText = '';
    if (search) search.value = '';
    return wasActive;
  };

  /** The mode dropdown's choice, shared with the View menu. */
  const choose = (choice: SidebarChoice) => {
    endSearch();
    preferences.update(
      choice === 'hidden'
        ? { sidebarVisible: false }
        : { sidebarVisible: true, sidebarMode: choice },
    );
    render();
  };

  listen(toggle, 'click', () => {
    // Hiding a search takeover ends the search and hides the sidebar.
    if (endSearch()) preferences.update({ sidebarVisible: false });
    else preferences.update({ sidebarVisible: !preferences.snapshot().sidebarVisible });
    render();
  });
  listen(modeToggle, 'click', () => setMenuOpen(!menuOpen()));
  listen(modeMenu, 'click', (event) => {
    const item =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-sidebar-mode]')
        : null;
    if (!item) return;
    const mode = SIDEBAR_MODES.find((candidate) => candidate === item.dataset.sidebarMode);
    choose(mode ?? 'hidden');
    setMenuOpen(false);
  });
  if (search) {
    listen(search, 'input', () => {
      cancelSearchTimer();
      const apply = () => {
        searchTimer = null;
        searchText = search.value;
        render();
      };
      // Clearing restores the sidebar immediately; typing waits for a pause.
      if (!search.value.trim() || searchDebounceMs <= 0) apply();
      else searchTimer = setTimeout(apply, searchDebounceMs);
    });
    listen(search, 'keydown', (event) => {
      if (event.key !== 'Escape' || !search.value) return;
      event.preventDefault();
      event.stopPropagation();
      endSearch();
      render();
    });
  }
  listen(document, 'pointerdown', (event) => {
    if (!menuOpen()) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (modeMenu.contains(target) || modeToggle.contains(target))) return;
    setMenuOpen(false);
  });
  listen(document, 'keydown', (event) => {
    if (event.key === 'Escape' && menuOpen()) {
      setMenuOpen(false);
      modeToggle.focus();
    }
  });

  if (resizer) {
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.setAttribute('aria-valuemin', String(SIDEBAR_WIDTH_BOUNDS.min));
    resizer.setAttribute('aria-valuemax', String(SIDEBAR_WIDTH_BOUNDS.max));
    resizer.setAttribute('aria-label', 'Resize sidebar');
    let drag: { startX: number; startWidth: number; width: number } | null = null;
    const clamp = (width: number) =>
      Math.round(Math.min(SIDEBAR_WIDTH_BOUNDS.max, Math.max(SIDEBAR_WIDTH_BOUNDS.min, width)));
    listen(resizer, 'keydown', (event) => {
      const delta =
        event.key === 'ArrowRight' ? RESIZE_STEP : event.key === 'ArrowLeft' ? -RESIZE_STEP : 0;
      if (delta === 0) return;
      event.preventDefault();
      preferences.update({ sidebarWidth: preferences.snapshot().sidebarWidth + delta });
    });
    listen(resizer, 'pointerdown', (event) => {
      event.preventDefault();
      const startWidth = preferences.snapshot().sidebarWidth;
      drag = { startX: event.clientX, startWidth, width: startWidth };
      resizer.setPointerCapture?.(event.pointerId);
      root.classList.add('resizing');
    });
    listen(resizer, 'pointermove', (event) => {
      if (!drag) return;
      drag.width = clamp(drag.startWidth + event.clientX - drag.startX);
      applyWidth(drag.width);
    });
    const endDrag = () => {
      if (!drag) return;
      const { width } = drag;
      drag = null;
      root.classList.remove('resizing');
      preferences.update({ sidebarWidth: width });
      applyWidth(preferences.snapshot().sidebarWidth);
    };
    listen(resizer, 'pointerup', endDrag);
    listen(resizer, 'pointercancel', endDrag);
  }

  cleanups.push(preferences.observe(render));

  return {
    refresh: render,
    choose,
    focusSearch() {
      search?.focus();
      search?.select();
    },
    destroy() {
      cancelSearchTimer();
      for (const cleanup of cleanups.splice(0)) cleanup();
      view?.view.destroy();
      view = null;
      searchView?.destroy();
      searchView = null;
    },
  };
}

function createThumbnailsView({
  dispatchReaderAction,
  whenVisible,
  width,
}: SidebarModeContext): SidebarModeView {
  const list = document.createElement('ol');
  list.className = 'sidebar-thumbnails';
  list.setAttribute('aria-label', 'Page thumbnails');
  // A Document Query is created per request; its generation identifies the loaded runtime.
  let shown: { filePath: string; pageCount: number; generation: number | undefined } | null = null;
  let currentPage = 0;
  let cancels: Array<() => void> = [];
  let generation = 0;

  const clear = () => {
    for (const cancel of cancels) cancel();
    cancels = [];
    generation += 1;
    list.replaceChildren();
  };

  const build = (sidebarDocument: SidebarDocument) => {
    clear();
    const buildGeneration = generation;
    const { pageCount, query } = sidebarDocument;
    for (let page = 1; page <= pageCount; page += 1) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sidebar-thumbnail';
      button.dataset.page = String(page);
      button.setAttribute('aria-label', `Page ${page}`);
      const image = document.createElement('span');
      image.className = 'sidebar-thumbnail-image';
      const label = document.createElement('span');
      label.className = 'sidebar-thumbnail-label';
      label.textContent = String(page);
      button.append(image, label);
      item.append(button);
      list.append(item);
      if (!query) continue;
      cancels.push(
        whenVisible(button, () => {
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
              if (generation === buildGeneration) console.error('Thumbnail failed:', error);
            });
        }),
      );
    }
  };

  const markCurrent = (page: number, reveal: boolean) => {
    for (const button of list.querySelectorAll<HTMLElement>('.sidebar-thumbnail')) {
      if (button.dataset.page === String(page)) {
        button.setAttribute('aria-current', 'page');
        if (reveal) button.scrollIntoView?.({ block: 'nearest' });
      } else {
        button.removeAttribute('aria-current');
      }
    }
  };

  list.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('.sidebar-thumbnail')
        : null;
    const page = Number(button?.dataset.page);
    if (!shown || !Number.isInteger(page) || page < 1) return;
    void dispatchReaderAction({ type: 'goToPage', page, filePath: shown.filePath });
  });

  return {
    element: list,
    update(sidebarDocument) {
      if (!sidebarDocument) {
        shown = null;
        currentPage = 0;
        clear();
        return;
      }
      const { filePath, pageCount, query } = sidebarDocument;
      const rebuilt =
        !shown ||
        shown.filePath !== filePath ||
        shown.pageCount !== pageCount ||
        shown.generation !== query?.generation;
      if (rebuilt) {
        shown = { filePath, pageCount, generation: query?.generation };
        build(sidebarDocument);
      }
      list.style.setProperty(
        '--sidebar-thumbnail-filter',
        buildFilterCSS(sidebarDocument.filterSettings),
      );
      if (rebuilt || sidebarDocument.currentPage !== currentPage) {
        currentPage = sidebarDocument.currentPage;
        markCurrent(currentPage, true);
      }
    },
    destroy: clear,
  };
}
