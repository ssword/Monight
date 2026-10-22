// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChromePreferencesAuthority,
  type ChromePreferencesStorage,
  loadChromePreferences,
} from '../app/chrome-preferences';
import { createReaderSidebar, type SidebarDocument } from '../app/reader-sidebar';
import type { DocumentQuery } from '../reader/document-queries';
import type { ReaderAction } from '../reader/reader-actions';
import type { FilterSettings } from '../scripts/filters';

const ORIGINAL: FilterSettings = {
  brightness: 0,
  grayscale: 0,
  invert: 0,
  sepia: 0,
  hue: 0,
  extraBrightness: 0,
};
const DARK: FilterSettings = { ...ORIGINAL, brightness: 10, invert: 90 };

function createStorage(initial?: unknown) {
  let stored = structuredClone(initial);
  const storage: ChromePreferencesStorage = {
    read: async () => structuredClone(stored),
    write: async (value) => {
      stored = structuredClone(value);
    },
  };
  return storage;
}

function fakeQuery(filePath: string) {
  const thumbnail = vi.fn(async (_page: number, options?: { maxWidth?: number }) => {
    const canvas = document.createElement('canvas');
    canvas.width = options?.maxWidth ?? 100;
    canvas.height = 10;
    canvas.dataset.filePath = filePath;
    canvas.dataset.page = String(_page);
    return canvas;
  });
  return {
    thumbnail,
    query: {
      filePath,
      generation: 1,
      isCurrent: () => true,
      thumbnail,
    } as unknown as DocumentQuery,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('reader sidebar', () => {
  let preferences: ChromePreferencesAuthority;
  let dispatched: ReaderAction[];
  let active: SidebarDocument | null;

  const mount = async (stored?: unknown) => {
    preferences = await loadChromePreferences(createStorage(stored), { debounceMs: 0 });
    const sidebar = createReaderSidebar({
      elements: {
        root: document.getElementById('reader-sidebar') as HTMLElement,
        toggle: document.getElementById('sidebar-toggle') as HTMLButtonElement,
        modeToggle: document.getElementById('sidebar-mode-toggle') as HTMLButtonElement,
        modeMenu: document.getElementById('sidebar-mode-menu') as HTMLElement,
      },
      preferences,
      activeDocument: () => active,
      dispatchReaderAction: async (action) => {
        dispatched.push(action);
      },
      whenVisible: (_element, show) => {
        show();
        return () => undefined;
      },
    });
    sidebar.refresh();
    return sidebar;
  };

  const sidebarRoot = () => document.getElementById('reader-sidebar') as HTMLElement;
  const thumbnails = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('#reader-sidebar button[data-page]'));
  const menuItem = (mode: string) =>
    document.querySelector<HTMLButtonElement>(`[data-sidebar-mode="${mode}"]`) as HTMLButtonElement;

  beforeEach(() => {
    dispatched = [];
    document.body.innerHTML = `
      <div id="toolbar">
        <button id="sidebar-toggle" type="button"></button>
        <button id="sidebar-mode-toggle" type="button" aria-expanded="false"></button>
        <div id="sidebar-mode-menu" class="hidden" role="menu">
          <button type="button" role="menuitemradio" data-sidebar-mode="hidden">Hide Sidebar</button>
          <button type="button" role="menuitemradio" data-sidebar-mode="thumbnails">Thumbnails</button>
        </div>
      </div>
      <div id="document-workspace">
        <aside id="reader-sidebar" hidden>
          <div class="reader-sidebar-content"></div>
          <div class="reader-sidebar-resizer" role="separator" tabindex="0"></div>
        </aside>
        <div id="pdf-container"></div>
      </div>
    `;
    active = {
      filePath: '/docs/report.pdf',
      pageCount: 3,
      currentPage: 1,
      filterSettings: DARK,
      query: fakeQuery('/docs/report.pdf').query,
    };
  });

  it('starts hidden and opens Thumbnails from the toolbar toggle', async () => {
    await mount();
    expect(sidebarRoot().hidden).toBe(true);
    expect(document.getElementById('sidebar-toggle')?.getAttribute('aria-pressed')).toBe('false');

    document.getElementById('sidebar-toggle')?.click();

    expect(sidebarRoot().hidden).toBe(false);
    expect(preferences.snapshot()).toMatchObject({
      sidebarVisible: true,
      sidebarMode: 'thumbnails',
    });
    expect(document.getElementById('sidebar-toggle')?.getAttribute('aria-pressed')).toBe('true');
    expect(thumbnails().map((button) => button.dataset.page)).toEqual(['1', '2', '3']);

    document.getElementById('sidebar-toggle')?.click();
    expect(sidebarRoot().hidden).toBe(true);
    expect(preferences.snapshot().sidebarVisible).toBe(false);
  });

  it('chooses Hide Sidebar or a mode from the mode dropdown', async () => {
    await mount();
    const modeToggle = document.getElementById('sidebar-mode-toggle') as HTMLButtonElement;
    const menu = document.getElementById('sidebar-mode-menu') as HTMLElement;

    modeToggle.click();
    expect(menu.classList.contains('hidden')).toBe(false);
    expect(modeToggle.getAttribute('aria-expanded')).toBe('true');
    expect(menuItem('hidden').getAttribute('aria-checked')).toBe('true');

    menuItem('thumbnails').click();
    expect(menu.classList.contains('hidden')).toBe(true);
    expect(sidebarRoot().hidden).toBe(false);
    expect(menuItem('thumbnails').getAttribute('aria-checked')).toBe('true');
    expect(menuItem('hidden').getAttribute('aria-checked')).toBe('false');

    modeToggle.click();
    menuItem('hidden').click();
    expect(sidebarRoot().hidden).toBe(true);
    expect(preferences.snapshot()).toMatchObject({
      sidebarVisible: false,
      sidebarMode: 'thumbnails',
    });
  });

  it('offers the dropdown choices to other input adapters such as View menu items', async () => {
    const sidebar = await mount({ schemaVersion: 1, sidebarMode: 'annotations' });

    sidebar.choose('thumbnails');
    expect(preferences.snapshot()).toMatchObject({
      sidebarVisible: true,
      sidebarMode: 'thumbnails',
    });
    expect(sidebarRoot().hidden).toBe(false);
    expect(menuItem('thumbnails').getAttribute('aria-checked')).toBe('true');

    sidebar.choose('hidden');
    expect(preferences.snapshot()).toMatchObject({
      sidebarVisible: false,
      sidebarMode: 'thumbnails',
    });
    expect(sidebarRoot().hidden).toBe(true);
  });

  it('closes the mode dropdown on Escape', async () => {
    await mount();
    document.getElementById('sidebar-mode-toggle')?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('sidebar-mode-menu')?.classList.contains('hidden')).toBe(true);
  });

  it('restores the stored sidebar on launch and keeps it across Document switches', async () => {
    const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true, sidebarWidth: 300 });
    expect(sidebarRoot().hidden).toBe(false);
    expect(sidebarRoot().style.width).toBe('300px');

    active = {
      filePath: '/docs/thesis.pdf',
      pageCount: 2,
      currentPage: 2,
      filterSettings: ORIGINAL,
      query: fakeQuery('/docs/thesis.pdf').query,
    };
    sidebar.refresh();

    expect(sidebarRoot().hidden).toBe(false);
    expect(thumbnails().map((button) => button.dataset.page)).toEqual(['1', '2']);
  });

  it('renders page thumbnails with the active Document filter', async () => {
    const { query, thumbnail } = fakeQuery('/docs/report.pdf');
    active = { ...(active as SidebarDocument), query };
    const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
    await flush();

    expect(thumbnail.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
    expect(
      document.querySelectorAll('#reader-sidebar [data-page="2"] canvas[data-page="2"]'),
    ).toHaveLength(1);
    const list = document.querySelector<HTMLElement>('#reader-sidebar .sidebar-thumbnails');
    expect(list?.style.getPropertyValue('--sidebar-thumbnail-filter')).toBe(
      'brightness(0.9) invert(0.9) brightness(1)',
    );

    // Each refresh asks Reader Actions for a fresh Document Query of the same runtime.
    active = { ...(active as SidebarDocument), filterSettings: ORIGINAL, query: { ...query } };
    sidebar.refresh();
    await flush();
    expect(list?.style.getPropertyValue('--sidebar-thumbnail-filter')).toBe(
      'brightness(1) brightness(1)',
    );
    expect(thumbnail).toHaveBeenCalledTimes(3);
  });

  it('re-renders only the thumbnails of pages whose Page Rotation changed', async () => {
    const { query, thumbnail } = fakeQuery('/docs/report.pdf');
    active = { ...(active as SidebarDocument), query, pageRotations: [0, 0, 0] };
    const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
    await flush();
    expect(thumbnail.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);

    // Rotating page 2 (and later undoing it) changes only that page's rotation.
    active = { ...(active as SidebarDocument), query: { ...query }, pageRotations: [0, 1, 0] };
    sidebar.refresh();
    await flush();
    active = { ...(active as SidebarDocument), query: { ...query }, pageRotations: [0, 0, 0] };
    sidebar.refresh();
    await flush();

    expect(thumbnail.mock.calls.map(([page]) => page)).toEqual([1, 2, 3, 2, 2]);
    expect(thumbnails().map((button) => button.dataset.page)).toEqual(['1', '2', '3']);
    expect(
      document.querySelectorAll('#reader-sidebar [data-page="2"] canvas[data-page="2"]'),
    ).toHaveLength(1);
  });

  it('labels thumbnails with page numbers and highlights the current page as the reader scrolls', async () => {
    const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
    expect(thumbnails().map((button) => button.textContent?.trim())).toEqual(['1', '2', '3']);
    expect(thumbnails().map((button) => button.getAttribute('aria-current'))).toEqual([
      'page',
      null,
      null,
    ]);

    active = { ...(active as SidebarDocument), currentPage: 3 };
    sidebar.refresh();

    expect(thumbnails().map((button) => button.getAttribute('aria-current'))).toEqual([
      null,
      null,
      'page',
    ]);
  });

  it('goes to a page when its thumbnail is clicked', async () => {
    await mount({ schemaVersion: 1, sidebarVisible: true });

    thumbnails()[1]?.click();

    expect(dispatched).toEqual([{ type: 'goToPage', page: 2, filePath: '/docs/report.pdf' }]);
  });

  describe('thumbnail selection', () => {
    const click = (page: number, init: MouseEventInit = {}) =>
      thumbnails()[page - 1]?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
      );
    const marked = () =>
      thumbnails()
        .filter((button) => button.dataset.selected === 'true')
        .map((button) => Number(button.dataset.page));

    beforeEach(() => {
      active = { ...(active as SidebarDocument), pageCount: 6, currentPage: 2 };
    });

    it('selects nothing until the reader extends it, so Rotate acts on the current page', async () => {
      const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
      expect(sidebar.selectedPages()).toEqual([]);

      click(4);

      expect(sidebar.selectedPages()).toEqual([]);
      expect(dispatched).toEqual([{ type: 'goToPage', page: 4, filePath: '/docs/report.pdf' }]);
    });

    it('adds and removes pages with ⌘-click or Ctrl-click, starting from the current page', async () => {
      const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });

      click(5, { metaKey: true });
      expect(sidebar.selectedPages()).toEqual([2, 5]);
      click(4, { ctrlKey: true });
      expect(sidebar.selectedPages()).toEqual([2, 4, 5]);
      click(2, { metaKey: true });
      expect(sidebar.selectedPages()).toEqual([4, 5]);
      expect(marked()).toEqual([4, 5]);
      expect(dispatched).toEqual([]);
    });

    it('selects a range with ⇧-click from the current page or the last page clicked', async () => {
      const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });

      click(4, { shiftKey: true });
      expect(sidebar.selectedPages()).toEqual([2, 3, 4]);
      click(6, { metaKey: true });
      click(5, { shiftKey: true });
      expect(sidebar.selectedPages()).toEqual([5, 6]);
      expect(marked()).toEqual([5, 6]);
    });

    it('a plain click ends the selection', async () => {
      const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
      click(4, { shiftKey: true });

      click(6);

      expect(sidebar.selectedPages()).toEqual([]);
      expect(marked()).toEqual([]);
    });

    it('keeps the selection while the reader scrolls and the thumbnails re-render', async () => {
      const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
      click(4, { shiftKey: true });

      active = {
        ...(active as SidebarDocument),
        currentPage: 6,
        query: { ...fakeQuery('/docs/report.pdf').query, generation: 2 } as DocumentQuery,
      };
      sidebar.refresh();

      expect(sidebar.selectedPages()).toEqual([2, 3, 4]);
      expect(marked()).toEqual([2, 3, 4]);
    });

    it('is cleared on Document switch', async () => {
      const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
      click(4, { shiftKey: true });

      active = { ...(active as SidebarDocument), filePath: '/docs/thesis.pdf' };
      sidebar.refresh();
      expect(sidebar.selectedPages()).toEqual([]);

      active = { ...(active as SidebarDocument), filePath: '/docs/report.pdf' };
      sidebar.refresh();
      expect(sidebar.selectedPages()).toEqual([]);
      expect(marked()).toEqual([]);
    });

    it('is not offered while Thumbnails is not shown', async () => {
      const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
      click(4, { shiftKey: true });

      sidebar.choose('hidden');
      expect(sidebar.selectedPages()).toEqual([]);
      sidebar.choose('thumbnails');
      expect(sidebar.selectedPages()).toEqual([]);
    });

    it('is never persisted', async () => {
      const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
      const before = preferences.snapshot();

      click(4, { shiftKey: true });
      click(6, { metaKey: true });
      sidebar.refresh();
      await preferences.flush();

      expect(preferences.snapshot()).toEqual(before);
      expect(dispatched).toEqual([]);
    });
  });

  it('ignores a thumbnail that finishes rendering after a Document switch', async () => {
    let finish!: (canvas: HTMLCanvasElement) => void;
    const slow = vi.fn(
      () =>
        new Promise<HTMLCanvasElement>((resolve) => {
          finish = resolve;
        }),
    );
    active = {
      ...(active as SidebarDocument),
      pageCount: 1,
      query: { filePath: '/docs/report.pdf', isCurrent: () => true, thumbnail: slow } as never,
    };
    const sidebar = await mount({ schemaVersion: 1, sidebarVisible: true });
    active = {
      filePath: '/docs/thesis.pdf',
      pageCount: 1,
      currentPage: 1,
      filterSettings: ORIGINAL,
      query: fakeQuery('/docs/thesis.pdf').query,
    };
    sidebar.refresh();
    await flush();

    const stale = document.createElement('canvas');
    stale.dataset.filePath = '/docs/report.pdf';
    finish(stale);
    await flush();

    expect(
      document.querySelectorAll('#reader-sidebar canvas[data-file-path="/docs/report.pdf"]'),
    ).toHaveLength(0);
    expect(
      document.querySelectorAll('#reader-sidebar canvas[data-file-path="/docs/thesis.pdf"]'),
    ).toHaveLength(1);
  });

  it('shows no thumbnails without an active Document', async () => {
    active = null;
    await mount({ schemaVersion: 1, sidebarVisible: true });
    expect(thumbnails()).toHaveLength(0);
  });

  it('resizes with the separator and remembers the width', async () => {
    await mount({ schemaVersion: 1, sidebarVisible: true, sidebarWidth: 220 });
    const resizer = document.querySelector('.reader-sidebar-resizer') as HTMLElement;
    expect(resizer.getAttribute('aria-valuenow')).toBe('220');

    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(preferences.snapshot().sidebarWidth).toBe(230);
    expect(sidebarRoot().style.width).toBe('230px');

    resizer.dispatchEvent(new PointerEvent('pointerdown', { clientX: 230, bubbles: true }));
    resizer.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, bubbles: true }));
    expect(sidebarRoot().style.width).toBe('300px');
    resizer.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, bubbles: true }));

    expect(preferences.snapshot().sidebarWidth).toBe(300);
    expect(resizer.getAttribute('aria-valuenow')).toBe('300');
  });

  it('changes chrome preferences only, never the Reading Session', async () => {
    await mount();
    document.getElementById('sidebar-toggle')?.click();
    document.getElementById('sidebar-mode-toggle')?.click();
    menuItem('thumbnails').click();
    document
      .querySelector('.reader-sidebar-resizer')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    expect(dispatched).toEqual([]);
  });
});
