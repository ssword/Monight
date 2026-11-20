// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { type BookmarkAuthority, loadBookmarks } from '../app/bookmarks';
import { loadChromePreferences } from '../app/chrome-preferences';
import { createReaderSidebar, type SidebarDocument } from '../app/reader-sidebar';
import type { DocumentQuery } from '../reader/document-queries';
import type { ReaderAction } from '../reader/reader-actions';
import { PRESETS } from '../scripts/filters';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const FILE = '/docs/report.pdf';

describe('Bookmarks sidebar mode', () => {
  let dispatched: ReaderAction[];
  let bookmarks: BookmarkAuthority;
  let currentPage: number;
  let pageCount: number;
  let changes: number;
  let thumbnails: number[];

  const active = (): SidebarDocument => ({
    filePath: FILE,
    pageCount,
    currentPage,
    filterSettings: PRESETS.default,
    query: {
      filePath: FILE,
      generation: 1,
      isCurrent: () => true,
      thumbnail: async (page: number) => {
        thumbnails.push(page);
        return document.createElement('canvas');
      },
    } as unknown as DocumentQuery,
  });

  const mount = async (visible = true) => {
    const preferences = await loadChromePreferences(
      {
        read: async () => ({
          schemaVersion: 1,
          sidebarVisible: visible,
          sidebarMode: 'bookmarks',
        }),
        write: async () => undefined,
      },
      { debounceMs: 0 },
    );
    const sidebar = createReaderSidebar({
      elements: {
        root: document.getElementById('reader-sidebar') as HTMLElement,
        toggle: document.getElementById('sidebar-toggle') as HTMLButtonElement,
        modeToggle: document.getElementById('sidebar-mode-toggle') as HTMLButtonElement,
        modeMenu: document.getElementById('sidebar-mode-menu') as HTMLElement,
      },
      preferences,
      activeDocument: active,
      dispatchReaderAction: async (action) => {
        dispatched.push(action);
        if (action.type === 'goToPage') currentPage = action.page;
      },
      bookmarks: () => bookmarks,
      whenVisible: (_element, show) => {
        show();
        return () => undefined;
      },
      onItemsChange: () => {
        changes += 1;
      },
    });
    sidebar.refresh();
    await flush();
    return { sidebar, preferences };
  };

  const rows = () =>
    [...document.querySelectorAll<HTMLElement>('.sidebar-bookmark')].map((row) => row.dataset.page);

  beforeEach(async () => {
    dispatched = [];
    changes = 0;
    thumbnails = [];
    currentPage = 1;
    pageCount = 9;
    bookmarks = await loadBookmarks({ read: async () => null, write: async () => undefined });
    document.body.innerHTML = `
      <button id="sidebar-toggle" type="button"></button>
      <button id="sidebar-mode-toggle" type="button"></button>
      <div id="sidebar-mode-menu" class="hidden">
        <button data-sidebar-mode="hidden"></button>
        <button data-sidebar-mode="bookmarks"></button>
      </div>
      <aside id="reader-sidebar"><div class="reader-sidebar-content"></div></aside>`;
  });

  it('lists the Document’s Bookmarks in page order with a page label and thumbnail', async () => {
    bookmarks.toggle(FILE, 7);
    bookmarks.toggle(FILE, 2);
    bookmarks.toggle('/docs/other.pdf', 5);
    await mount();
    expect(rows()).toEqual(['2', '7']);
    expect(document.querySelector('.sidebar-bookmark-label')?.textContent).toBe('Page 2');
    expect(thumbnails.sort()).toEqual([2, 7]);
    expect(document.querySelector('.sidebar-bookmark canvas')).not.toBeNull();
  });

  it('shows an empty state explaining how to add a Bookmark', async () => {
    await mount();
    expect(rows()).toEqual([]);
    expect(document.querySelector('.sidebar-bookmarks-empty')?.textContent).toContain(
      'Add Bookmark',
    );
  });

  it('updates when a Bookmark is added or removed elsewhere', async () => {
    const { sidebar } = await mount();
    bookmarks.toggle(FILE, 4);
    sidebar.refresh();
    expect(rows()).toEqual(['4']);
    bookmarks.toggle(FILE, 4);
    sidebar.refresh();
    expect(rows()).toEqual([]);
  });

  it('goes to the page and records the jump in Navigation History when clicked', async () => {
    bookmarks.toggle(FILE, 5);
    await mount();
    document.querySelector<HTMLElement>('.sidebar-bookmark')?.click();
    await flush();
    expect(dispatched).toEqual([
      { type: 'goToPage', page: 5, filePath: FILE, recordHistory: true },
    ]);
    expect(document.querySelector('.sidebar-bookmark')?.getAttribute('aria-current')).toBe('true');
  });

  it('removes a Bookmark from the store when its remove button is pressed', async () => {
    bookmarks.toggle(FILE, 3);
    bookmarks.toggle(FILE, 6);
    await mount();
    document.querySelector<HTMLElement>('.sidebar-bookmark-remove[data-page="3"]')?.click();
    expect(bookmarks.pages(FILE)).toEqual([6]);
    expect(rows()).toEqual(['6']);
    expect(dispatched).toEqual([]);
  });

  it('ignores Bookmarks beyond the page count', async () => {
    bookmarks.toggle(FILE, 4);
    bookmarks.toggle(FILE, 20);
    await mount();
    expect(rows()).toEqual(['4']);
  });

  it('exposes its items and selection for Previous Item and Next Item', async () => {
    bookmarks.toggle(FILE, 2);
    bookmarks.toggle(FILE, 5);
    bookmarks.toggle(FILE, 8);
    currentPage = 5;
    const { sidebar } = await mount();
    expect(sidebar.itemStepping()).toEqual({ previous: true, next: true });
    await sidebar.stepItem('next');
    expect(dispatched).toEqual([
      { type: 'goToPage', page: 8, filePath: FILE, recordHistory: true },
    ]);
    expect(sidebar.itemStepping()).toEqual({ previous: true, next: false });
    expect(changes).toBeGreaterThan(0);
  });
  describe('Previous Item and Next Item', () => {
    it('steps backwards and forwards through the Bookmarks in page order, selecting each', async () => {
      for (const page of [8, 2, 5]) bookmarks.toggle(FILE, page);
      currentPage = 8;
      const { sidebar } = await mount();

      await sidebar.stepItem('previous');
      await sidebar.stepItem('previous');
      expect(dispatched.map((a) => (a as { page: number }).page)).toEqual([5, 2]);
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: true });
      expect(
        document.querySelector('.sidebar-bookmark[aria-current="true"]')?.getAttribute('data-page'),
      ).toBe('2');

      await sidebar.stepItem('next');
      expect(dispatched[2]).toMatchObject({ page: 5, filePath: FILE, recordHistory: true });
    });

    it('does nothing past the first or last Bookmark', async () => {
      bookmarks.toggle(FILE, 3);
      bookmarks.toggle(FILE, 6);
      currentPage = 6;
      const { sidebar } = await mount();
      expect(sidebar.itemStepping()).toEqual({ previous: true, next: false });
      await sidebar.stepItem('next');
      expect(dispatched).toEqual([]);
      await sidebar.stepItem('previous');
      await sidebar.stepItem('previous');
      expect(dispatched).toHaveLength(1);
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: true });
    });

    it('is unavailable when the Document has no Bookmarks', async () => {
      const { sidebar } = await mount();
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: false });
      await sidebar.stepItem('next');
      expect(dispatched).toEqual([]);
    });

    it('follows Bookmarks added or removed after mounting', async () => {
      bookmarks.toggle(FILE, 4);
      currentPage = 4;
      const { sidebar } = await mount();
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: false });
      bookmarks.toggle(FILE, 7);
      sidebar.refresh();
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: true });
      bookmarks.toggle(FILE, 7);
      sidebar.refresh();
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: false });
    });

    it('is unavailable while the sidebar is hidden', async () => {
      bookmarks.toggle(FILE, 4);
      bookmarks.toggle(FILE, 6);
      const { sidebar } = await mount(false);
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: false });
    });
  });
});
