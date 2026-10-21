// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChromePreferencesAuthority,
  type ChromePreferencesStorage,
  loadChromePreferences,
} from '../app/chrome-preferences';
import { createReaderSidebar, type SidebarDocument } from '../app/reader-sidebar';
import type { PdfOutlineItem } from '../lib/document-features';
import type { DocumentQuery } from '../reader/document-queries';
import type { ReaderAction } from '../reader/reader-actions';
import { PRESETS } from '../scripts/filters';

function createStorage(initial?: unknown) {
  let stored = structuredClone(initial);
  const storage: ChromePreferencesStorage = {
    read: async () => structuredClone(stored),
    write: async (value) => {
      stored = structuredClone(value);
    },
  };
  return { storage, stored: () => stored };
}

const entry = (
  title: string,
  target: PdfOutlineItem['target'],
  items: PdfOutlineItem[] = [],
): PdfOutlineItem => ({
  title,
  pageNumber: target?.readingPosition?.page ?? null,
  ...(target ? { target } : {}),
  bold: false,
  italic: false,
  items,
});

const OUTLINE: PdfOutlineItem[] = [
  entry('Introduction', { readingPosition: { page: 1, location: 0 } }),
  entry('Methods', { readingPosition: { page: 2, location: 0.5 } }, [
    entry('Sampling', { readingPosition: { page: 3, location: 0 } }, [
      entry('Weights', { readingPosition: { page: 3, location: 0.4 } }),
    ]),
  ]),
  entry('Project website', { url: 'https://example.com/project' }),
];

function documentWithOutline(
  filePath: string,
  outline: readonly PdfOutlineItem[],
  generation = 1,
): SidebarDocument & { outline: ReturnType<typeof vi.fn> } {
  const read = vi.fn(async () => structuredClone(outline) as PdfOutlineItem[]);
  return {
    filePath,
    pageCount: 3,
    currentPage: 1,
    filterSettings: PRESETS.default,
    query: {
      filePath,
      generation,
      isCurrent: () => true,
      outline: read,
    } as unknown as DocumentQuery,
    outline: read,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('reader sidebar Table of Contents', () => {
  let preferences: ChromePreferencesAuthority;
  let dispatched: ReaderAction[];
  let active: SidebarDocument | null;

  const mount = async (stored?: unknown) => {
    const { storage } = createStorage(stored);
    preferences = await loadChromePreferences(storage, { debounceMs: 0 });
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
    await flush();
    return sidebar;
  };

  const openContents = async () => {
    await mount({ schemaVersion: 1, sidebarVisible: true, sidebarMode: 'tableOfContents' });
  };
  const entries = () =>
    Array.from(document.querySelectorAll<HTMLElement>('#reader-sidebar [role="treeitem"]'));
  const visibleTitles = () =>
    entries()
      .filter((item) => !item.closest('[role="group"][hidden]'))
      .map((item) => item.querySelector('.sidebar-outline-title')?.textContent);
  const entryNamed = (title: string) =>
    entries().find(
      (item) => item.querySelector('.sidebar-outline-title')?.textContent === title,
    ) as HTMLElement;
  const disclosure = (title: string) =>
    entryNamed(title).querySelector<HTMLButtonElement>('.sidebar-outline-disclosure');
  const link = (title: string) =>
    entryNamed(title).querySelector<HTMLButtonElement>('.sidebar-outline-link');

  beforeEach(() => {
    dispatched = [];
    document.body.innerHTML = `
      <div id="toolbar">
        <button id="sidebar-toggle" type="button"></button>
        <button id="sidebar-mode-toggle" type="button" aria-expanded="false"></button>
        <div id="sidebar-mode-menu" class="hidden" role="menu">
          <button type="button" role="menuitemradio" data-sidebar-mode="hidden">Hide Sidebar</button>
          <button type="button" role="menuitemradio" data-sidebar-mode="thumbnails">Thumbnails</button>
          <button type="button" role="menuitemradio" data-sidebar-mode="tableOfContents">Table of Contents</button>
        </div>
      </div>
      <div id="document-workspace">
        <aside id="reader-sidebar" hidden>
          <div class="reader-sidebar-content"></div>
          <div class="reader-sidebar-resizer" role="separator" tabindex="0"></div>
        </aside>
      </div>
    `;
    active = documentWithOutline('/docs/report.pdf', OUTLINE);
  });

  it('is chosen from the mode dropdown and remembered with the other sidebar preferences', async () => {
    const { storage, stored } = createStorage();
    preferences = await loadChromePreferences(storage, { debounceMs: 0 });
    createReaderSidebar({
      elements: {
        root: document.getElementById('reader-sidebar') as HTMLElement,
        toggle: document.getElementById('sidebar-toggle') as HTMLButtonElement,
        modeToggle: document.getElementById('sidebar-mode-toggle') as HTMLButtonElement,
        modeMenu: document.getElementById('sidebar-mode-menu') as HTMLElement,
      },
      preferences,
      activeDocument: () => active,
      dispatchReaderAction: async () => undefined,
    }).refresh();

    document.getElementById('sidebar-mode-toggle')?.click();
    document.querySelector<HTMLElement>('[data-sidebar-mode="tableOfContents"]')?.click();
    await preferences.flush();
    await flush();

    expect(stored()).toMatchObject({ sidebarVisible: true, sidebarMode: 'tableOfContents' });
    expect(
      document.querySelector('[data-sidebar-mode="tableOfContents"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(visibleTitles()).toEqual(['Introduction', 'Methods', 'Project website']);

    // A relaunch restores the mode.
    await mount(stored());
    expect(visibleTitles()).toEqual(['Introduction', 'Methods', 'Project website']);
  });

  it('nests entries under their parents, collapsed until expanded', async () => {
    await openContents();

    expect(visibleTitles()).toEqual(['Introduction', 'Methods', 'Project website']);
    expect(entryNamed('Methods').getAttribute('aria-level')).toBe('1');
    expect(entryNamed('Methods').getAttribute('aria-expanded')).toBe('false');
    expect(entryNamed('Introduction').hasAttribute('aria-expanded')).toBe(false);
    expect(disclosure('Introduction')).toBeNull();

    disclosure('Methods')?.click();
    expect(entryNamed('Methods').getAttribute('aria-expanded')).toBe('true');
    expect(visibleTitles()).toEqual(['Introduction', 'Methods', 'Sampling', 'Project website']);
    expect(entryNamed('Sampling').getAttribute('aria-level')).toBe('2');

    disclosure('Sampling')?.click();
    expect(visibleTitles()).toContain('Weights');
    expect(entryNamed('Weights').getAttribute('aria-level')).toBe('3');

    disclosure('Methods')?.click();
    expect(visibleTitles()).toEqual(['Introduction', 'Methods', 'Project website']);
    expect(dispatched).toEqual([]);
  });

  it('expands and collapses with the arrow keys', async () => {
    await openContents();

    link('Methods')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(entryNamed('Methods').getAttribute('aria-expanded')).toBe('true');
    link('Methods')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    expect(entryNamed('Methods').getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps expanded entries while the same Document refreshes', async () => {
    const sidebar = await mount({
      schemaVersion: 1,
      sidebarVisible: true,
      sidebarMode: 'tableOfContents',
    });
    disclosure('Methods')?.click();
    active = { ...(active as SidebarDocument), currentPage: 3 };
    sidebar.refresh();
    await flush();

    expect(visibleTitles()).toContain('Sampling');
  });

  it('activates an entry target through the Reader Action', async () => {
    await openContents();
    disclosure('Methods')?.click();

    link('Sampling')?.click();
    link('Project website')?.click();

    expect(dispatched).toEqual([
      {
        type: 'activateDocumentTarget',
        filePath: '/docs/report.pdf',
        target: { readingPosition: { page: 3, location: 0 } },
      },
      {
        type: 'activateDocumentTarget',
        filePath: '/docs/report.pdf',
        target: { url: 'https://example.com/project' },
      },
    ]);
  });

  it('shows entries without a target but does not activate them', async () => {
    active = documentWithOutline('/docs/report.pdf', [entry('Untitled part', undefined)]);
    await openContents();

    expect(link('Untitled part')?.disabled).toBe(true);
    link('Untitled part')?.click();
    expect(dispatched).toEqual([]);
  });

  const emptyState = () =>
    document.querySelector<HTMLElement>('#reader-sidebar .sidebar-empty-state')?.textContent;

  it('shows an empty state for a Document without an outline', async () => {
    active = documentWithOutline('/docs/scan.pdf', []);
    await openContents();

    expect(entries()).toHaveLength(0);
    expect(emptyState()).toBe('No Table of Contents');
  });

  it('shows an empty state when no Document is open', async () => {
    active = null;
    await openContents();

    expect(emptyState()).toBe('No Document');
  });

  it('follows Document switches and ignores an outline that arrives late', async () => {
    let finish!: (items: PdfOutlineItem[]) => void;
    const slow = new Promise<PdfOutlineItem[]>((resolve) => {
      finish = resolve;
    });
    active = {
      ...documentWithOutline('/docs/report.pdf', []),
      query: {
        filePath: '/docs/report.pdf',
        generation: 1,
        isCurrent: () => true,
        outline: () => slow,
      } as unknown as DocumentQuery,
    };
    const sidebar = await mount({
      schemaVersion: 1,
      sidebarVisible: true,
      sidebarMode: 'tableOfContents',
    });

    active = documentWithOutline('/docs/thesis.pdf', [
      entry('Abstract', { readingPosition: { page: 1, location: 0 } }),
    ]);
    sidebar.refresh();
    await flush();
    finish(OUTLINE);
    await flush();

    expect(visibleTitles()).toEqual(['Abstract']);
    link('Abstract')?.click();
    expect(dispatched).toEqual([
      expect.objectContaining({ type: 'activateDocumentTarget', filePath: '/docs/thesis.pdf' }),
    ]);
  });

  it('reloads the outline when the Document runtime is replaced', async () => {
    const sidebar = await mount({
      schemaVersion: 1,
      sidebarVisible: true,
      sidebarMode: 'tableOfContents',
    });
    const reloaded = documentWithOutline(
      '/docs/report.pdf',
      [entry('Revised', { readingPosition: { page: 1, location: 0 } })],
      2,
    );
    active = reloaded;
    sidebar.refresh();
    await flush();

    expect(reloaded.outline).toHaveBeenCalledTimes(1);
    expect(visibleTitles()).toEqual(['Revised']);
  });

  it('is offered in the app toolbar mode dropdown', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    const item = document.querySelector('#sidebar-mode-menu [data-sidebar-mode="tableOfContents"]');
    expect(item?.textContent).toBe('Table of Contents');
    expect(item?.getAttribute('role')).toBe('menuitemradio');
  });
});
