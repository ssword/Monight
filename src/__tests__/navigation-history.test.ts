import { describe, expect, it, vi } from 'vitest';
import type { DocumentContent } from '../reader/document-content';
import type { DocumentRuntime } from '../reader/document-queries';
import {
  createReaderActions,
  type ReaderProjection,
  type ReadingPosition,
} from '../reader/reader-actions';

const FIRST = '/docs/first.pdf';
const SECOND = '/docs/second.pdf';

const INITIAL_SESSION = {
  schemaVersion: 3 as const,
  activeDocumentPath: FIRST,
  documents: [
    { filePath: FIRST, title: 'first.pdf', readingPosition: { page: 2, location: 0.25 } },
    { filePath: SECOND, title: 'second.pdf', readingPosition: { page: 7, location: 0.5 } },
  ],
};

function createRuntime(): DocumentRuntime {
  const content: DocumentContent = {
    pageCount: 20,
    getPage: vi.fn(async () => {
      throw new Error('Page unavailable in Navigation History test');
    }),
    getData: vi.fn(async () => new Uint8Array()),
    search: vi.fn(async () => []),
    getOutline: vi.fn(async () => []),
    getMetadata: vi.fn(async () => null),
    // Link, outline, search and annotation targets all resolve through here.
    resolveLinkTarget: vi.fn(async (target) => {
      if (target.readingPosition) {
        return {
          kind: 'page' as const,
          pageNumber: target.readingPosition.page,
          location: target.readingPosition.location,
        };
      }
      if (target.dest === 'chapter-9')
        return { kind: 'page' as const, pageNumber: 9, location: 0.4 };
      return null;
    }),
    destroy: vi.fn(async () => undefined),
  };
  return {
    saveSource: 'loaded-source',
    content,
    destroy: vi.fn(async () => content.destroy()),
    renderThumbnail: vi.fn(async () => {
      throw new Error('Thumbnail unavailable in Navigation History test');
    }),
  };
}

/**
 * A projection that, like the real viewer, knows where the reader currently is
 * before that position settles into the Reading Session.
 */
function createHarness() {
  const live = new Map<string, ReadingPosition>();
  const projection: ReaderProjection = {
    activateDocument: vi.fn(async () => undefined),
    goToReadingPosition: vi.fn(async (filePath, position) => {
      if ('location' in position) live.set(filePath, position);
    }),
    getPageCount: () => 20,
    currentReadingPosition: (filePath) => live.get(filePath) ?? null,
  };
  const reader = createReaderActions({
    initialSession: INITIAL_SESSION,
    projection,
    persist: vi.fn(async () => undefined),
  });
  const register = async (filePath: string) => {
    const document = INITIAL_SESSION.documents.find((item) => item.filePath === filePath);
    if (!document) throw new Error(`Unknown fixture ${filePath}`);
    await reader.dispatch({ type: 'registerDocument', document, runtime: createRuntime() });
  };
  /** The reader scrolls; the viewer reports it and it settles. */
  const scrollTo = async (filePath: string, position: ReadingPosition) => {
    live.set(filePath, position);
    await reader.dispatch({ type: 'settleReadingPosition', filePath, readingPosition: position });
  };
  const position = (filePath: string) =>
    reader.snapshot().documents.find((item) => item.filePath === filePath)?.readingPosition;
  return { reader, projection, live, register, scrollTo, position };
}

describe('Navigation History', () => {
  it('Back returns to the exact Reading Position before a link jump; Forward reapplies it', async () => {
    const { reader, live, register, position } = createHarness();
    await register(FIRST);
    // Scrolled but not yet settled: the live position is what Back must return to.
    live.set(FIRST, { page: 3, location: 0.6 });

    await reader.dispatch({
      type: 'activateDocumentTarget',
      filePath: FIRST,
      target: { dest: 'chapter-9' },
    });
    expect(reader.canGoBack(FIRST)).toBe(true);
    expect(reader.canGoForward(FIRST)).toBe(false);

    await expect(reader.dispatch({ type: 'goBack' })).resolves.toMatchObject({
      status: 'committed',
    });
    expect(position(FIRST)).toEqual({ page: 3, location: 0.6 });
    expect(live.get(FIRST)).toEqual({ page: 3, location: 0.6 });
    expect(reader.canGoBack(FIRST)).toBe(false);
    expect(reader.canGoForward(FIRST)).toBe(true);

    await reader.dispatch({ type: 'goForward' });
    expect(position(FIRST)).toEqual({ page: 9, location: 0.4 });
    expect(reader.canGoBack(FIRST)).toBe(true);
    expect(reader.canGoForward(FIRST)).toBe(false);
  });

  it('records search, outline and Go to Page jumps but not scrolling, thumbnails or page steps', async () => {
    const { reader, register, scrollTo, position } = createHarness();
    await register(FIRST);

    await scrollTo(FIRST, { page: 4, location: 0.1 });
    await reader.dispatch({ type: 'goToPage', page: 6 }); // thumbnail / surface navigation
    await reader.dispatch({ type: 'goToNextPage' });
    expect(reader.canGoBack(FIRST)).toBe(false);

    // A search result or outline entry carries its Reading Position.
    await reader.dispatch({
      type: 'activateDocumentTarget',
      filePath: FIRST,
      target: { readingPosition: { page: 12, location: 0.3 } },
    });
    await reader.dispatch({ type: 'goToPage', page: 15, recordHistory: true }); // Go to Page…
    await scrollTo(FIRST, { page: 16, location: 0.2 });

    await reader.dispatch({ type: 'goBack' });
    expect(position(FIRST)).toEqual({ page: 12, location: 0.3 });
    await reader.dispatch({ type: 'goBack' });
    expect(position(FIRST)).toEqual({ page: 7, location: 0 });
    expect(reader.canGoBack(FIRST)).toBe(false);
    await expect(reader.dispatch({ type: 'goBack' })).resolves.toMatchObject({ status: 'no-op' });

    await reader.dispatch({ type: 'goForward' });
    await reader.dispatch({ type: 'goForward' });
    // Forward returns to where Back left from, including the later scroll.
    expect(position(FIRST)).toEqual({ page: 16, location: 0.2 });
  });

  it('discards forward entries when a new jump follows Back', async () => {
    const { reader, register, position } = createHarness();
    await register(FIRST);
    await reader.dispatch({ type: 'goToPage', page: 5, recordHistory: true });
    await reader.dispatch({ type: 'goToPage', page: 10, recordHistory: true });
    await reader.dispatch({ type: 'goBack' });
    expect(reader.canGoForward(FIRST)).toBe(true);

    await reader.dispatch({ type: 'goToPage', page: 18, recordHistory: true });

    expect(reader.canGoForward(FIRST)).toBe(false);
    await reader.dispatch({ type: 'goBack' });
    expect(position(FIRST)).toEqual({ page: 5, location: 0 });
  });

  it('keeps each Document its own history and never crosses Documents', async () => {
    const { reader, register, position } = createHarness();
    await register(FIRST);
    await register(SECOND);
    await reader.dispatch({ type: 'goToPage', page: 5, recordHistory: true });
    await reader.dispatch({ type: 'activateDocument', filePath: SECOND });

    expect(reader.canGoBack()).toBe(false);
    expect(reader.canGoBack(FIRST)).toBe(true);
    await expect(reader.dispatch({ type: 'goBack' })).resolves.toMatchObject({ status: 'no-op' });
    expect(position(SECOND)).toEqual({ page: 7, location: 0.5 });
    expect(position(FIRST)).toEqual({ page: 5, location: 0 });
  });

  it('is absent from Reading Session snapshots and discarded when the Document closes', async () => {
    const persist = vi.fn(async () => undefined);
    const projection: ReaderProjection = {
      activateDocument: vi.fn(async () => undefined),
      goToReadingPosition: vi.fn(async () => undefined),
      closeDocument: vi.fn(async () => undefined),
    };
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection,
      persist,
      reopenDocument: async (filePath) => {
        const document = INITIAL_SESSION.documents.find((item) => item.filePath === filePath);
        if (!document) throw new Error('unknown');
        await reader.dispatch({
          type: 'registerDocument',
          document,
          runtime: createRuntime(),
          activate: true,
        });
      },
    });
    await reader.dispatch({
      type: 'registerDocument',
      document: INITIAL_SESSION.documents[0],
      runtime: createRuntime(),
    });
    await reader.dispatch({ type: 'goToPage', page: 5, recordHistory: true });
    await reader.flush();

    const snapshot = reader.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual([
      'activeDocumentPath',
      'documents',
      'revision',
      'schemaVersion',
    ]);
    expect(Object.keys(snapshot.documents[0]).sort()).toEqual([
      'filePath',
      'readingPosition',
      'title',
      'visualState',
    ]);
    expect(persist).toHaveBeenCalled();
    for (const [persisted] of persist.mock.calls as unknown as [object][]) {
      expect(JSON.stringify(persisted)).not.toMatch(/history|back|forward/i);
    }

    await reader.dispatch({ type: 'closeDocument', filePath: FIRST });
    expect(reader.canGoBack(FIRST)).toBe(false);
    await reader.dispatch({ type: 'reopenLastClosedDocument' });
    expect(reader.isDocumentOpen(FIRST)).toBe(true);
    expect(reader.canGoBack(FIRST)).toBe(false);
  });

  it('follows the Document to its canonical path', async () => {
    const { reader, register } = createHarness();
    await register(FIRST);
    await reader.dispatch({ type: 'goToPage', page: 5, recordHistory: true });

    await reader.canonicalizeDocumentPaths([
      { requestedPath: FIRST, canonicalPath: '/real/first.pdf', runtimeStateSource: 'requested' },
    ]);

    expect(reader.canGoBack(FIRST)).toBe(false);
    expect(reader.canGoBack('/real/first.pdf')).toBe(true);
  });

  it('follows the Document through Save As', async () => {
    let savedRevision = 0;
    const runtime = createRuntime();
    runtime.editing = {
      state: () => ({ revision: 1, dirty: savedRevision !== 1, readOnlyReason: null }),
      exportPdf: async () => new Uint8Array([1]),
      markSaved: (revision) => {
        savedRevision = revision;
      },
    };
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: async () => undefined,
        goToReadingPosition: async () => undefined,
        verifySavedDocument: async () => undefined,
        reidentifyDocument: () => undefined,
      },
      pdfSaveAdapter: {
        writeOriginal: async (_token, bytes) => bytes,
        chooseDestination: async () => ({
          token: 'copy',
          canonicalPath: '/docs/copy.pdf',
          title: 'copy.pdf',
        }),
        writeDestination: async (_destination, bytes) => bytes,
        releaseDestination: async () => undefined,
      },
      persist: async () => undefined,
    });
    await reader.dispatch({
      type: 'registerDocument',
      document: INITIAL_SESSION.documents[0],
      runtime,
    });
    await reader.dispatch({ type: 'goToPage', page: 5, recordHistory: true });

    await expect(reader.dispatch({ type: 'saveDocumentAs' })).resolves.toMatchObject({
      status: 'committed',
    });

    expect(reader.canGoBack('/docs/copy.pdf')).toBe(true);
    await reader.dispatch({ type: 'goBack' });
    expect(reader.snapshot().documents[0]).toMatchObject({
      filePath: '/docs/copy.pdf',
      readingPosition: { page: 2, location: 0.25 },
    });
  });
});
