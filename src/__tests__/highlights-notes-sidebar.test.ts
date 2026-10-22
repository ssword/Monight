// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ChromePreferencesAuthority,
  type ChromePreferencesStorage,
  loadChromePreferences,
} from '../app/chrome-preferences';
import { createReaderSidebar, type SidebarDocument } from '../app/reader-sidebar';
import type { DocumentAnnotationSnapshot, DocumentQuery } from '../reader/document-queries';
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

function storage(initial?: unknown): ChromePreferencesStorage {
  let stored = structuredClone(initial);
  return {
    read: async () => structuredClone(stored),
    write: async (value) => {
      stored = structuredClone(value);
    },
  };
}

const note = (
  overrides: Partial<DocumentAnnotationSnapshot> & Pick<DocumentAnnotationSnapshot, 'id'>,
): DocumentAnnotationSnapshot => ({
  kind: 'note',
  pageNumber: 1,
  readingPosition: { page: 1, location: 0.1 },
  author: 'Ada Lovelace',
  contents: '',
  color: null,
  modified: null,
  ...overrides,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Highlights and Notes sidebar', () => {
  let preferences: ChromePreferencesAuthority;
  let dispatched: ReaderAction[];
  let revealed: Array<{ filePath: string; annotationId: string }>;
  let annotations: DocumentAnnotationSnapshot[];
  let active: SidebarDocument | null;

  const query = (filePath: string): DocumentQuery =>
    ({
      filePath,
      generation: 1,
      isCurrent: () => true,
      annotations: async () => annotations.map((annotation) => ({ ...annotation })),
    }) as unknown as DocumentQuery;

  const mount = async () => {
    preferences = await loadChromePreferences(
      storage({ schemaVersion: 1, sidebarVisible: true, sidebarMode: 'annotations' }),
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
      activeDocument: () => active,
      dispatchReaderAction: async (action) => {
        dispatched.push(action);
      },
      revealAnnotation: (filePath, annotationId) => {
        revealed.push({ filePath, annotationId });
      },
    });
    sidebar.refresh();
    await flush();
    return sidebar;
  };

  const groups = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>('#reader-sidebar .sidebar-annotation-page'),
    ).map((group) => ({
      heading: group.querySelector('.sidebar-annotation-page-heading')?.textContent,
      entries: Array.from(group.querySelectorAll<HTMLElement>('.sidebar-annotation')).map(
        (entry) => entry.querySelector('.sidebar-annotation-text')?.textContent,
      ),
    }));
  const entry = (id: string) =>
    document.querySelector<HTMLButtonElement>(
      `#reader-sidebar .sidebar-annotation[data-annotation-id="${id}"]`,
    ) as HTMLButtonElement;

  beforeEach(() => {
    dispatched = [];
    revealed = [];
    document.body.innerHTML = `
      <button id="sidebar-toggle" type="button"></button>
      <button id="sidebar-mode-toggle" type="button" aria-expanded="false"></button>
      <div id="sidebar-mode-menu" class="hidden" role="menu">
        <button type="button" role="menuitemradio" data-sidebar-mode="hidden">Hide Sidebar</button>
        <button type="button" role="menuitemradio" data-sidebar-mode="thumbnails">Thumbnails</button>
        <button type="button" role="menuitemradio" data-sidebar-mode="annotations">Highlights and Notes</button>
      </div>
      <aside id="reader-sidebar" hidden><div class="reader-sidebar-content"></div></aside>
    `;
    annotations = [];
    active = {
      filePath: '/docs/report.pdf',
      pageCount: 3,
      currentPage: 1,
      filterSettings: ORIGINAL,
      query: query('/docs/report.pdf'),
    };
  });

  it('lists highlights, underlines, strikeouts and notes from any author, grouped by page', async () => {
    annotations = [
      note({ id: 'n1', contents: 'Check this claim', author: 'Andrew Chen' }),
      note({
        id: 'h1',
        kind: 'highlight',
        contents: 'Preview native highlight 75',
        readingPosition: { page: 1, location: 0.4 },
      }),
      note({
        id: 'u3',
        kind: 'underline',
        pageNumber: 3,
        readingPosition: { page: 3, location: 0.2 },
        author: 'ssword',
      }),
      note({
        id: 's3',
        kind: 'strikeout',
        pageNumber: 3,
        readingPosition: { page: 3, location: 0.5 },
        contents: 'Remove',
      }),
    ];

    await mount();

    expect(groups()).toEqual([
      { heading: 'Page 1', entries: ['Check this claim', 'Preview native highlight 75'] },
      { heading: 'Page 3', entries: ['Underline', 'Remove'] },
    ]);
    expect(entry('n1').textContent).toContain('Andrew Chen');
    expect(entry('u3').textContent).toContain('ssword');
    expect(entry('u3').dataset.annotationKind).toBe('underline');
  });

  it('goes to and reveals an Annotation when its entry is clicked', async () => {
    annotations = [
      note({
        id: 'h2',
        kind: 'highlight',
        pageNumber: 2,
        readingPosition: { page: 2, location: 0.62 },
        contents: 'Key result',
      }),
    ];
    await mount();

    entry('h2').click();
    await flush();

    expect(dispatched).toEqual([
      {
        type: 'activateDocumentTarget',
        filePath: '/docs/report.pdf',
        target: { readingPosition: { page: 2, location: 0.62 } },
      },
    ]);
    expect(revealed).toEqual([{ filePath: '/docs/report.pdf', annotationId: 'h2' }]);
  });

  it('stays current as Annotations are created, edited and deleted', async () => {
    const sidebar = await mount();
    expect(document.querySelector('#reader-sidebar .sidebar-annotations-empty')?.textContent).toBe(
      'No Highlights or Notes',
    );

    annotations = [note({ id: 'n1', contents: 'First thought' })];
    sidebar.refresh();
    await flush();
    expect(groups()).toEqual([{ heading: 'Page 1', entries: ['First thought'] }]);

    annotations = [note({ id: 'n1', contents: 'Second thought' })];
    sidebar.refresh();
    await flush();
    expect(groups()).toEqual([{ heading: 'Page 1', entries: ['Second thought'] }]);

    annotations = [];
    sidebar.refresh();
    await flush();
    expect(groups()).toEqual([]);
    expect(entry('n1')).toBeNull();
  });

  it('keeps the rendered list when a refresh brings no Annotation change', async () => {
    annotations = [note({ id: 'n1', contents: 'Stable' })];
    const sidebar = await mount();
    const before = entry('n1');

    sidebar.refresh();
    await flush();

    expect(entry('n1')).toBe(before);
  });

  it("shows the newly active Document's Annotations after a switch", async () => {
    annotations = [note({ id: 'a', contents: 'Report note' })];
    const sidebar = await mount();
    const thesis = [note({ id: 'b', contents: 'Thesis note', pageNumber: 2 })];
    active = {
      filePath: '/docs/thesis.pdf',
      pageCount: 2,
      currentPage: 1,
      filterSettings: ORIGINAL,
      query: {
        ...query('/docs/thesis.pdf'),
        annotations: async () => thesis,
      } as DocumentQuery,
    };

    sidebar.refresh();
    await flush();

    expect(groups()).toEqual([{ heading: 'Page 2', entries: ['Thesis note'] }]);
    entry('b').click();
    await flush();
    expect(dispatched[0]).toMatchObject({ filePath: '/docs/thesis.pdf' });
  });

  it('shows nothing without an active Document', async () => {
    annotations = [note({ id: 'n1', contents: 'Hidden' })];
    active = null;
    await mount();
    expect(groups()).toEqual([]);
  });
});
