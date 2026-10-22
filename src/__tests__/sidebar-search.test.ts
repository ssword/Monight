// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChromePreferencesAuthority,
  type ChromePreferencesStorage,
  loadChromePreferences,
} from '../app/chrome-preferences';
import {
  createReaderSidebar,
  type ReaderSidebar,
  type SidebarDocument,
} from '../app/reader-sidebar';
import type { PdfSearchMatch } from '../lib/document-features';
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

const MATCHES: PdfSearchMatch[] = [
  { pageNumber: 1, pageOccurrence: 0, index: 4, excerpt: '…the moon rose over…', location: 0.25 },
  { pageNumber: 1, pageOccurrence: 1, index: 90, excerpt: 'a Moon of ice', location: 0.75 },
  { pageNumber: 3, pageOccurrence: 0, index: 12, excerpt: 'no moon tonight', location: 0.5 },
];

function createStorage(initial?: unknown) {
  let stored = structuredClone(initial);
  const writes: unknown[] = [];
  const storage: ChromePreferencesStorage = {
    read: async () => structuredClone(stored),
    write: async (value) => {
      stored = structuredClone(value);
      writes.push(structuredClone(value));
    },
  };
  return { storage, writes };
}

function fakeQuery(filePath: string, matches: readonly PdfSearchMatch[] = MATCHES) {
  const search = vi.fn(async (text: string) =>
    matches.filter((match) => match.excerpt.toLowerCase().includes(text.trim().toLowerCase())),
  );
  return {
    search,
    query: {
      filePath,
      generation: 1,
      isCurrent: () => true,
      search,
      thumbnail: vi.fn(async () => document.createElement('canvas')),
    } as unknown as DocumentQuery,
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('sidebar search', () => {
  let preferences: ChromePreferencesAuthority;
  let writes: unknown[];
  let dispatched: ReaderAction[];
  let active: SidebarDocument | null;
  let sidebar: ReaderSidebar;

  const field = () => document.getElementById('toolbar-search') as HTMLInputElement;
  const sidebarRoot = () => document.getElementById('reader-sidebar') as HTMLElement;
  const menuItem = (mode: string) =>
    document.querySelector<HTMLButtonElement>(`[data-sidebar-mode="${mode}"]`) as HTMLButtonElement;
  const results = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('#reader-sidebar .search-result'));
  const pageHeadings = () =>
    Array.from(document.querySelectorAll('#reader-sidebar .search-result-page')).map(
      (heading) => heading.textContent,
    );

  const mount = async (stored?: unknown) => {
    const created = createStorage(stored);
    writes = created.writes;
    preferences = await loadChromePreferences(created.storage, { debounceMs: 0 });
    sidebar = createReaderSidebar({
      elements: {
        root: sidebarRoot(),
        toggle: document.getElementById('sidebar-toggle') as HTMLButtonElement,
        modeToggle: document.getElementById('sidebar-mode-toggle') as HTMLButtonElement,
        modeMenu: document.getElementById('sidebar-mode-menu') as HTMLElement,
        search: field(),
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
      searchDebounceMs: 0,
    });
    sidebar.refresh();
    return sidebar;
  };

  const type = async (text: string) => {
    field().value = text;
    field().dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  };

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
        <input id="toolbar-search" type="search" />
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
      filterSettings: ORIGINAL,
      query: fakeQuery('/docs/report.pdf').query,
    };
  });

  it('takes over a hidden sidebar with results grouped by page and their context', async () => {
    await mount();
    expect(sidebarRoot().hidden).toBe(true);

    await type('moon');

    expect(sidebarRoot().hidden).toBe(false);
    expect(sidebarRoot().dataset.sidebarMode).toBe('search');
    expect(pageHeadings()).toEqual(['Page 1', 'Page 3']);
    expect(results().map((result) => result.textContent)).toEqual([
      '…the moon rose over…',
      'a Moon of ice',
      'no moon tonight',
    ]);
    expect(results().map((result) => result.querySelector('mark')?.textContent)).toEqual([
      'moon',
      'Moon',
      'moon',
    ]);
  });

  it('goes to a hit through the go-to-target Reader Action', async () => {
    await mount();
    await type('moon');

    results()[1]?.click();

    expect(dispatched).toEqual([
      {
        type: 'activateDocumentTarget',
        filePath: '/docs/report.pdf',
        target: { readingPosition: { page: 1, location: 0.75 } },
      },
    ]);
  });

  it('restores a hidden sidebar when the search is cleared', async () => {
    await mount();
    await type('moon');
    await type('');

    expect(sidebarRoot().hidden).toBe(true);
    expect(results()).toEqual([]);
    expect(preferences.snapshot()).toMatchObject({ sidebarVisible: false });
  });

  it('restores the previous visible mode when the search is cleared', async () => {
    await mount({ schemaVersion: 1, sidebarVisible: true, sidebarMode: 'thumbnails' });
    expect(sidebarRoot().dataset.sidebarMode).toBe('thumbnails');

    await type('moon');
    expect(sidebarRoot().dataset.sidebarMode).toBe('search');
    expect(document.querySelectorAll('#reader-sidebar .sidebar-thumbnail')).toHaveLength(0);

    await type('');
    expect(sidebarRoot().hidden).toBe(false);
    expect(sidebarRoot().dataset.sidebarMode).toBe('thumbnails');
    expect(document.querySelectorAll('#reader-sidebar .sidebar-thumbnail')).toHaveLength(3);
  });

  it('clears the search on Escape in the field', async () => {
    await mount();
    await type('moon');

    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(field().value).toBe('');
    expect(sidebarRoot().hidden).toBe(true);
  });

  it('never persists the takeover as the sidebar mode', async () => {
    await mount();
    await type('moon');
    sidebar.refresh();
    await preferences.flush();

    expect(writes).toEqual([]);
    expect(preferences.snapshot().sidebarMode).toBe('thumbnails');
    expect(menuItem('thumbnails').getAttribute('aria-checked')).toBe('false');
  });

  it('ends the search when a sidebar mode is chosen', async () => {
    await mount();
    await type('moon');

    menuItem('thumbnails').click();

    expect(field().value).toBe('');
    expect(sidebarRoot().dataset.sidebarMode).toBe('thumbnails');
    expect(preferences.snapshot()).toMatchObject({ sidebarVisible: true });
  });

  it('ends the search and hides the sidebar from the toggle', async () => {
    await mount({ schemaVersion: 1, sidebarVisible: true, sidebarMode: 'thumbnails' });
    await type('moon');

    document.getElementById('sidebar-toggle')?.click();

    expect(field().value).toBe('');
    expect(sidebarRoot().hidden).toBe(true);
    expect(preferences.snapshot().sidebarVisible).toBe(false);
  });

  it('searches the newly active Document after a switch', async () => {
    await mount();
    await type('moon');
    const other = fakeQuery('/docs/thesis.pdf', [
      { pageNumber: 2, pageOccurrence: 0, index: 0, excerpt: 'moonlight', location: 0 },
    ]);
    active = { ...(active as SidebarDocument), filePath: '/docs/thesis.pdf', query: other.query };

    sidebar.refresh();
    await flush();

    expect(other.search).toHaveBeenCalledWith('moon', expect.anything());
    expect(pageHeadings()).toEqual(['Page 2']);
    results()[0]?.click();
    expect(dispatched[0]).toMatchObject({ filePath: '/docs/thesis.pdf' });
  });

  it('does not re-run the search on unrelated refreshes', async () => {
    const { query, search } = fakeQuery('/docs/report.pdf');
    active = { ...(active as SidebarDocument), query };
    await mount();
    await type('moon');
    sidebar.refresh();
    sidebar.refresh();

    expect(search).toHaveBeenCalledTimes(1);
  });

  it('reports when nothing matches', async () => {
    await mount();
    await type('sun');

    expect(results()).toEqual([]);
    expect(document.querySelector('#reader-sidebar .search-status')?.textContent).toBe(
      'No results',
    );
  });

  it('focuses and selects the Search field for Find', async () => {
    await mount();
    field().value = 'moon';

    sidebar.focusSearch();

    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(4);
  });
});

describe('toolbar Search field', () => {
  it('sits at the trailing edge of the toolbar and never drags the window', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    document.body.innerHTML = html
      .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
      .replace(/<script[\s\S]*?<\/script>/g, '');
    const toolbar = document.getElementById('toolbar') as HTMLElement;
    const field = document.getElementById('toolbar-search') as HTMLInputElement;

    expect(field.type).toBe('search');
    expect(field.getAttribute('aria-label')).toBe('Search');
    expect(field.getAttribute('aria-controls')).toBe('reader-sidebar');
    expect(toolbar.lastElementChild?.contains(field)).toBe(true);
    expect(field.closest('[data-tauri-drag-region="false"]')).not.toBeNull();
  });
});
