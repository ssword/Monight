// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { loadChromePreferences } from '../app/chrome-preferences';
import { createReaderSidebar, type SidebarDocument } from '../app/reader-sidebar';
import type { PdfOutlineItem } from '../lib/document-features';
import type { DocumentAnnotationSnapshot, DocumentQuery } from '../reader/document-queries';
import type { ReaderAction } from '../reader/reader-actions';
import { PRESETS } from '../scripts/filters';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const FILE = '/docs/report.pdf';

const outlineEntry = (
  title: string,
  page: number | null,
  items: PdfOutlineItem[] = [],
): PdfOutlineItem => ({
  title,
  pageNumber: page,
  ...(page === null ? {} : { target: { readingPosition: { page, location: 0 } } }),
  bold: false,
  italic: false,
  items,
});

const annotation = (id: string, page: number): DocumentAnnotationSnapshot => ({
  id,
  kind: 'highlight',
  pageNumber: page,
  readingPosition: { page, location: 0.2 },
  author: 'Ada',
  contents: id,
  color: null,
  modified: null,
});

describe('Previous Item and Next Item in the sidebar', () => {
  let dispatched: ReaderAction[];
  let revealed: string[];
  let outline: PdfOutlineItem[];
  let annotations: DocumentAnnotationSnapshot[];
  let currentPage: number;
  let pageCount: number;
  let changes: number;

  const active = (): SidebarDocument => ({
    filePath: FILE,
    pageCount,
    currentPage,
    filterSettings: PRESETS.default,
    query: {
      filePath: FILE,
      generation: 1,
      isCurrent: () => true,
      outline: async () => structuredClone(outline),
      annotations: async () => structuredClone(annotations),
    } as unknown as DocumentQuery,
  });

  const mount = async (mode: string) => {
    const preferences = await loadChromePreferences(
      {
        read: async () =>
          mode === 'hidden'
            ? { schemaVersion: 1, sidebarVisible: false }
            : { schemaVersion: 1, sidebarVisible: true, sidebarMode: mode },
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
        if (action.type === 'activateDocumentTarget' && action.target.readingPosition) {
          currentPage = action.target.readingPosition.page;
        }
      },
      revealAnnotation: (_filePath, id) => revealed.push(id),
      whenVisible: () => () => undefined,
      onItemsChange: () => {
        changes += 1;
      },
    });
    sidebar.refresh();
    await flush();
    return sidebar;
  };

  beforeEach(() => {
    dispatched = [];
    revealed = [];
    changes = 0;
    currentPage = 1;
    pageCount = 3;
    outline = [
      outlineEntry('Intro', 1),
      outlineEntry('Methods', 2, [outlineEntry('Sampling', 3)]),
      outlineEntry('Website', null),
    ];
    annotations = [annotation('a1', 2), annotation('a2', 2), annotation('a3', 3)];
    document.body.innerHTML = `
      <button id="sidebar-toggle" type="button"></button>
      <button id="sidebar-mode-toggle" type="button"></button>
      <div id="sidebar-mode-menu" class="hidden"></div>
      <aside id="reader-sidebar"><div class="reader-sidebar-content"></div></aside>`;
  });

  describe('Thumbnails', () => {
    it('starts from the page nearest the Reading Position and records each step', async () => {
      currentPage = 2;
      const sidebar = await mount('thumbnails');
      expect(sidebar.itemStepping()).toEqual({ previous: true, next: true });

      await sidebar.stepItem('next');
      expect(dispatched).toEqual([
        { type: 'goToPage', page: 3, filePath: FILE, recordHistory: true },
      ]);
      expect(sidebar.itemStepping()).toEqual({ previous: true, next: false });

      await sidebar.stepItem('previous');
      expect(dispatched[1]).toMatchObject({ page: 2, recordHistory: true });
      await sidebar.stepItem('previous');
      expect(dispatched[2]).toMatchObject({ page: 1 });
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: true });
    });

    it('steps from the selected page while the reader is still on it', async () => {
      currentPage = 1;
      const sidebar = await mount('thumbnails');
      await sidebar.stepItem('next');
      currentPage = 2; // the reader arrived at the selected page
      await sidebar.stepItem('next');
      expect(dispatched[1]).toMatchObject({ page: 3 });
    });

    it('lets the Reading Position override a stale selection', async () => {
      const sidebar = await mount('thumbnails');
      await sidebar.stepItem('next');
      currentPage = 1; // the reader scrolled back; the selection is stale
      await sidebar.stepItem('next');
      expect(dispatched[1]).toMatchObject({ page: 2 });
    });

    it('does nothing at the last page', async () => {
      currentPage = 3;
      const sidebar = await mount('thumbnails');
      await sidebar.stepItem('next');
      expect(dispatched).toEqual([]);
    });
  });

  describe('Table of Contents', () => {
    it('steps through entries with a destination in outline order, expanding the nested one', async () => {
      const sidebar = await mount('tableOfContents');
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: true });

      await sidebar.stepItem('next');
      await sidebar.stepItem('next');
      await sidebar.stepItem('next');

      expect(dispatched.map((a) => (a as { target: unknown }).target)).toEqual([
        { readingPosition: { page: 2, location: 0 } },
        { readingPosition: { page: 3, location: 0 } },
      ]);
      expect(sidebar.itemStepping()).toEqual({ previous: true, next: false });
      const nested = document.querySelector('[role="treeitem"][aria-expanded="true"]');
      expect(nested?.textContent).toContain('Sampling');
      expect(document.querySelector('[data-selected="true"]')?.textContent).toBe('Sampling');
    });

    it('has no steps when the Document has no outline', async () => {
      outline = [];
      const sidebar = await mount('tableOfContents');
      expect(sidebar.itemStepping()).toEqual({ previous: false, next: false });
    });
  });

  describe('Highlights and Notes', () => {
    it('steps through Annotations by page and selects each on the surface', async () => {
      currentPage = 2;
      const sidebar = await mount('annotations');

      await sidebar.stepItem('next');
      await sidebar.stepItem('next');

      expect(revealed).toEqual(['a2', 'a3']);
      expect(dispatched[0]).toMatchObject({
        type: 'activateDocumentTarget',
        filePath: FILE,
        target: { readingPosition: { page: 2, location: 0.2 } },
      });
      expect(sidebar.itemStepping()).toEqual({ previous: true, next: false });
    });
  });

  it('is unavailable while the sidebar is hidden', async () => {
    const sidebar = await mount('hidden');
    expect(sidebar.itemStepping()).toEqual({ previous: false, next: false });
    await sidebar.stepItem('next');
    expect(dispatched).toEqual([]);
  });

  it('reports a change when the available items or selection change', async () => {
    const sidebar = await mount('annotations');
    expect(changes).toBeGreaterThan(0);
    const before = changes;
    await sidebar.stepItem('next');
    expect(changes).toBeGreaterThan(before);
  });
});
