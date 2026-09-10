// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentWorkspace,
  type DocumentSurface,
  type DocumentSurfaceCallbacks,
} from '../app/document-workspace';
import { createDocumentIntake, type DocumentRuntimeIntake } from '../reader/document-intake';
import type { DocumentRuntime } from '../reader/document-queries';
import type { DocumentRendering } from '../reader/document-rendering';
import { normalizeAnnotationDisplayName } from '../reader/native-pdf-editing';
import {
  createReaderActions,
  type ReaderAction,
  type ReaderActions,
  type ReadingSessionSnapshot,
  type RestorableReadingPosition,
} from '../reader/reader-actions';
import { PRESETS } from '../scripts/filters';

const snapshot = (
  documents: ReadingSessionSnapshot['documents'],
  activeDocumentPath: string | null,
): ReadingSessionSnapshot => ({ schemaVersion: 2, revision: 1, activeDocumentPath, documents });

interface ControllableSurface {
  readonly rendering: DocumentRendering;
  readonly runtime: DocumentRuntime;
  visible(): boolean;
}

function createControllableSurface(
  filePath: string,
  failReadingPositionCall?: number,
): ControllableSurface {
  let currentPage = 1;
  let visible = false;
  let readingPositionCalls = 0;
  const runtime: DocumentRuntime = {
    destroy: vi.fn(async () => undefined),
    renderThumbnail: async () => document.createElement('canvas'),
    getAnnotations: () => [],
    content: {
      pageCount: 12,
      getData: async () => new Uint8Array([1]),
      getPage: async () => {
        throw new Error('No page handle needed');
      },
      search: async () => [],
      getOutline: async () => [],
      getMetadata: async () => null,
      resolveLinkTarget: async () => null,
      destroy: async () => undefined,
    },
  };
  const rendering = {
    getState: () => ({
      currentPage,
      totalPages: 12,
      zoom: 1,
      zoomIntent: { kind: 'manual' as const, scale: 1 },
      rotation: 0,
      fileName: filePath.split('/').pop() ?? filePath,
      filePath,
      viewMode: 'single' as const,
    }),
    getReadingPosition: () => ({ page: currentPage, location: 0 }),
    applyFilter: vi.fn(),
    setRotation: vi.fn(async () => undefined),
    setViewMode: vi.fn(async () => undefined),
    setZoomIntent: vi.fn(async () => undefined),
    goToReadingPosition: vi.fn(async (position: RestorableReadingPosition) => {
      readingPositionCalls += 1;
      if (readingPositionCalls === failReadingPositionCall) {
        throw new Error('activation rendering failed');
      }
      currentPage = position.page;
    }),
    setVisible: vi.fn((nextVisible: boolean) => {
      visible = nextVisible;
    }),
    destroy: vi.fn(),
  } as unknown as DocumentRendering;
  return { rendering, runtime, visible: () => visible };
}

describe('Document workspace adapter', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tab-container"></div>
      <div id="document-workspace"></div>
    `;
  });

  it('applies a changed annotation display name to future edits in every live Document', async () => {
    const authorUpdates: Array<ReturnType<typeof vi.fn>> = [];
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: vi.fn(async () => ({ status: 'committed' as const, revision: 1 })),
      snapshot: () => snapshot([], null),
      isDocumentOpen: () => false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'fit-width' },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: async ({ filePath }) => {
        const surface = createControllableSurface(filePath);
        const setAnnotationDisplayName = vi.fn();
        authorUpdates.push(setAnnotationDisplayName);
        surface.runtime.editing = {
          state: () => ({ revision: 0, dirty: false, readOnlyReason: null }),
          exportPdf: async () => new Uint8Array([1]),
          markSaved: vi.fn(),
          setAnnotationDisplayName,
        };
        return surface;
      },
    });
    for (const filePath of ['/first.pdf', '/second.pdf']) {
      await workspace.intakeRuntime.open({
        document: { canonicalPath: filePath, title: filePath.slice(1) },
        bytes: new Uint8Array([1]),
        activate: false,
      });
    }

    workspace.setAnnotationDisplayName(normalizeAnnotationDisplayName('Ada Lovelace'));

    expect(authorUpdates).toHaveLength(2);
    expect(authorUpdates.every((update) => update.mock.calls[0]?.[0] === 'Ada Lovelace')).toBe(
      true,
    );
  });

  it('routes edited tab close through Cancel and Discard and retires viewer callbacks on reopen', async () => {
    let reader: ReaderActions;
    let choice: 'cancel' | 'discard' = 'cancel';
    const callbacks: DocumentSurfaceCallbacks[] = [];
    const initialSession = { schemaVersion: 2 as const, documents: [], activeDocumentPath: null };
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action, options) => reader.dispatch(action, options),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (path) => reader?.isDocumentOpen(path) ?? false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'fit-width' },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: async ({ filePath, callbacks: events }) => {
        callbacks.push(events);
        const surface = createControllableSurface(filePath);
        surface.runtime.editing = {
          state: () => ({ revision: 1, dirty: true, readOnlyReason: null }),
          exportPdf: async () => {
            throw new Error('Close must not silently export');
          },
          markSaved: () => {
            throw new Error('Discard must not mark edits saved');
          },
        };
        return surface;
      },
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      chooseUnsavedDocument: async () => choice,
      persist: async () => undefined,
    });
    reader.observe(workspace.project);
    const open = () =>
      workspace.intakeRuntime.open({
        document: { canonicalPath: '/first.pdf', title: 'first.pdf' },
        bytes: new Uint8Array([1]),
        activate: true,
      });
    await open();
    document.querySelector<HTMLButtonElement>('.tab-close')?.click();
    await vi.waitFor(() => expect(reader.snapshot().documents).toHaveLength(1));
    // Wait for the semantic close outcome before making the next decision.
    await reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    expect(document.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    await callbacks[0].pageNavigationRequested(3);
    expect(reader.snapshot().documents[0].readingPosition.page).toBe(3);
    choice = 'discard';
    document.querySelector<HTMLButtonElement>('.tab-close')?.click();
    await vi.waitFor(() => expect(document.querySelector('.tab-close')).toBeNull());
    expect(reader.snapshot().documents).toHaveLength(0);
    await open();
    await callbacks[0].pageNavigationRequested(9);
    expect(reader.snapshot().documents[0].readingPosition.page).toBe(1);
    expect(document.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
  });

  it.each([
    ['recover', [9], true],
    ['discard', [1], false],
  ] as const)(
    '%s a matching Recovery Draft when reopening after termination',
    async (choice, expectedBytes, expectedDirty) => {
      const openedBytes: number[][] = [];
      const remove = vi.fn(async () => undefined);
      let reader: ReaderActions;
      let editRevision = 0;
      let savedRevision = 0;
      const initialSession = { schemaVersion: 2 as const, documents: [], activeDocumentPath: null };
      const workspace = createDocumentWorkspace({
        dispatchReaderAction: (action, options) => reader.dispatch(action, options),
        captureRecoveryDraft: (filePath) => reader.captureRecoveryDraft(filePath),
        snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
        isDocumentOpen: (path) => reader?.isDocumentOpen(path) ?? false,
        defaultVisualState: () => ({
          filterSettings: PRESETS.default,
          zoomIntent: { kind: 'fit-width' },
          rotation: 0,
          viewMode: 'single',
        }),
        recoveryDraftAdapter: {
          inspect: async () => ({
            status: 'available',
            sourceVersion: 'source-v1',
            draft: {
              documentPath: '/first.pdf',
              sourceVersion: 'source-v1',
              editedRevision: 4,
              bytes: new Uint8Array([9]),
            },
          }),
          write: vi.fn(),
          reconcile: vi.fn(),
          remove,
        },
        chooseRecoveryDraft: async () => choice,
        createSurface: async ({ filePath, bytes }) => {
          openedBytes.push([...bytes]);
          const surface = createControllableSurface(filePath);
          surface.runtime.editing = {
            state: () => ({
              revision: editRevision,
              dirty: editRevision !== savedRevision,
              readOnlyReason: null,
            }),
            exportPdf: async () => bytes,
            markSaved: (revision) => {
              savedRevision = revision;
            },
            markRecovered: (revision) => {
              editRevision = revision;
            },
          };
          return surface;
        },
      });
      const recoveryDraftAdapter = {
        inspect: vi.fn(),
        write: vi.fn(),
        reconcile: vi.fn(),
        remove,
      };
      reader = createReaderActions({
        initialSession,
        projection: workspace.projection,
        recoveryDraftAdapter,
        persist: async () => undefined,
      });
      reader.observe(workspace.project);

      await workspace.intakeRuntime.open({
        document: { canonicalPath: '/first.pdf', title: 'first.pdf' },
        bytes: new Uint8Array([1]),
        activate: true,
      });

      expect(openedBytes).toEqual([expectedBytes]);
      expect(reader.query('/first.pdf')).not.toBeNull();
      expect(reader.hasUnsavedPdfWork()).toBe(expectedDirty);
      expect(remove).toHaveBeenCalledTimes(choice === 'discard' ? 1 : 0);
    },
  );

  it('isolates a stale Recovery Draft from a changed source Document', async () => {
    const openedBytes: number[][] = [];
    const reportError = vi.fn();
    const choice = vi.fn(async () => 'recover' as const);
    const initialSession = { schemaVersion: 2 as const, documents: [], activeDocumentPath: null };
    let reader: ReaderActions;
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action, options) => reader.dispatch(action, options),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (path) => reader?.isDocumentOpen(path) ?? false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'fit-width' },
        rotation: 0,
        viewMode: 'single',
      }),
      recoveryDraftAdapter: {
        inspect: async () => ({ status: 'stale', sourceVersion: 'source-v2' }),
        write: vi.fn(),
        reconcile: vi.fn(),
        remove: vi.fn(),
      },
      chooseRecoveryDraft: choice,
      reportError,
      createSurface: async ({ filePath, bytes }) => {
        openedBytes.push([...bytes]);
        return createControllableSurface(filePath);
      },
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      persist: async () => undefined,
    });

    await workspace.intakeRuntime.open({
      document: { canonicalPath: '/first.pdf', title: 'first.pdf' },
      bytes: new Uint8Array([2]),
      activate: true,
    });

    expect(openedBytes).toEqual([[2]]);
    expect(choice).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('changed'));
  });

  it('keeps a Recovery Draft isolated when the reader postpones the decision', async () => {
    const remove = vi.fn();
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: vi.fn(),
      snapshot: () => snapshot([], null),
      isDocumentOpen: () => false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'fit-width' },
        rotation: 0,
        viewMode: 'single',
      }),
      recoveryDraftAdapter: {
        inspect: async () => ({
          status: 'available',
          sourceVersion: 'source-v1',
          draft: {
            documentPath: '/first.pdf',
            sourceVersion: 'source-v1',
            editedRevision: 4,
            bytes: new Uint8Array([9]),
          },
        }),
        write: vi.fn(),
        reconcile: vi.fn(),
        remove,
      },
      chooseRecoveryDraft: async () => 'cancel',
      createSurface: vi.fn(),
    });

    await expect(
      workspace.intakeRuntime.open({
        document: { canonicalPath: '/first.pdf', title: 'first.pdf' },
        bytes: new Uint8Array([1]),
        activate: true,
      }),
    ).rejects.toThrow('Recovery Draft decision cancelled');
    expect(remove).not.toHaveBeenCalled();
  });

  it('captures a Recovery Draft while annotation editing is live', async () => {
    const callbacks: DocumentSurfaceCallbacks[] = [];
    let revision = 0;
    let reader: ReaderActions;
    const initialSession = { schemaVersion: 2 as const, documents: [], activeDocumentPath: null };
    const write = vi.fn(async () => undefined);
    const reportError = vi.fn();
    const recoveryDraftAdapter = {
      inspect: vi.fn(async () => ({ status: 'none' as const, sourceVersion: 'source-v1' })),
      write,
      reconcile: vi.fn(async () => ({ sourceVersion: 'source-v2' })),
      remove: vi.fn(async () => undefined),
    };
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action, options) => reader.dispatch(action, options),
      captureRecoveryDraft: (filePath) => reader.captureRecoveryDraft(filePath),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (path) => reader?.isDocumentOpen(path) ?? false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'fit-width' },
        rotation: 0,
        viewMode: 'single',
      }),
      recoveryDraftAdapter,
      reportError,
      createSurface: async ({ filePath, callbacks: events }) => {
        callbacks.push(events);
        const surface = createControllableSurface(filePath);
        surface.runtime.editing = {
          state: () => ({ revision, dirty: revision > 0, readOnlyReason: null }),
          exportPdf: async () => new Uint8Array([revision]),
          markSaved: vi.fn(),
        };
        return surface;
      },
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      recoveryDraftAdapter,
      persist: async () => undefined,
    });
    reader.observe(workspace.project);
    await workspace.intakeRuntime.open({
      document: { canonicalPath: '/first.pdf', title: 'first.pdf' },
      bytes: new Uint8Array([1]),
      activate: true,
    });

    revision = 1;
    callbacks[0].stateChanged();

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith({
      documentPath: '/first.pdf',
      sourceVersion: 'source-v1',
      editedRevision: 1,
      bytes: new Uint8Array([1]),
    });
    await reader.quiesce();

    write.mockRejectedValueOnce(new Error('draft disk full'));
    revision = 2;
    callbacks[0].stateChanged();

    await vi.waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(expect.stringContaining('draft disk full')),
    );
    expect(reader.hasUnsavedPdfWork()).toBe(true);
  });

  it('projects tab controls from Reading Session snapshots and dispatches semantic actions', async () => {
    const dispatch = vi.fn(async (_action: ReaderAction) => ({
      status: 'committed' as const,
      revision: 2,
    }));
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: dispatch,
      snapshot: () => snapshot([], null),
      isDocumentOpen: () => false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(async () => {
        throw new Error('not used');
      }),
    });
    const readingSession = snapshot(
      [
        {
          filePath: '/docs/one.pdf',
          title: 'one.pdf',
          readingPosition: { page: 1, location: 0 },
          visualState: {
            filterSettings: PRESETS.default,
            zoomIntent: { kind: 'manual', scale: 1 },
            rotation: 0,
            viewMode: 'single',
          },
        },
        {
          filePath: '/docs/two.pdf',
          title: 'two.pdf',
          readingPosition: { page: 2, location: 0 },
          visualState: {
            filterSettings: PRESETS.default,
            zoomIntent: { kind: 'fit-width' },
            rotation: 0,
            viewMode: 'continuous',
          },
        },
      ],
      '/docs/two.pdf',
    );

    workspace.project(readingSession);

    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.dataset.filePath)).toEqual(['/docs/one.pdf', '/docs/two.pdf']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);

    tabs[0].click();
    document.querySelector<HTMLButtonElement>('[aria-label="Close one.pdf"]')?.click();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'activateDocument', filePath: '/docs/one.pdf' },
      { type: 'closeDocument', filePath: '/docs/one.pdf' },
    ]);
  });

  it('turns Document Intake into registration and activation Reader Actions', async () => {
    let current = snapshot([], null);
    const rendering = {
      applyFilter: vi.fn(),
      setRotation: vi.fn(async () => undefined),
      setViewMode: vi.fn(async () => undefined),
      setZoomIntent: vi.fn(async () => undefined),
      goToReadingPosition: vi.fn(async () => undefined),
      getReadingPosition: vi.fn(() => ({ page: 4, location: 0 })),
      setVisible: vi.fn(),
      destroy: vi.fn(),
    } as unknown as DocumentRendering;
    const runtime: DocumentRuntime = {
      destroy: vi.fn(async () => undefined),
      renderThumbnail: async () => document.createElement('canvas'),
      getAnnotations: () => [],
      content: {
        pageCount: 12,
        getData: async () => new Uint8Array([1]),
        getPage: async () => {
          throw new Error('No page handle needed');
        },
        search: async () => [],
        getOutline: async () => [],
        getMetadata: async () => null,
        resolveLinkTarget: async () => null,
        destroy: async () => undefined,
      },
    };
    const dispatched: ReaderAction[] = [];
    const dispatch = vi.fn(async (action: ReaderAction) => {
      dispatched.push(action);
      if (action.type === 'registerDocument') {
        current = snapshot([...current.documents, action.document], current.activeDocumentPath);
      }
      if (action.type === 'activateDocument') {
        current = snapshot(current.documents, action.filePath);
      }
      return { status: 'committed' as const, revision: current.revision };
    });
    const createSurface = vi.fn(async () => ({ rendering, runtime: runtime as never }));
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: dispatch,
      snapshot: () => current,
      isDocumentOpen: () => false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface,
    });

    const bytes = new Uint8Array([1, 2, 3]);
    await workspace.intakeRuntime.open({
      document: { canonicalPath: '/docs/report.pdf', title: 'report.pdf' },
      bytes,
      activate: true,
      initialPage: 4,
    });

    expect(createSurface).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/docs/report.pdf', title: 'report.pdf', bytes }),
    );
    expect(dispatched.map(({ type }) => type)).toEqual(['registerDocument']);
    expect(dispatched[0]).toMatchObject({
      type: 'registerDocument',
      activate: true,
      document: {
        filePath: '/docs/report.pdf',
        title: 'report.pdf',
        readingPosition: { page: 4, location: 0 },
      },
    });
  });

  it('does not treat an unrestored Reading Session entry as a live Document runtime', () => {
    const savedDocument = {
      filePath: '/docs/saved.pdf',
      title: 'saved.pdf',
      readingPosition: { page: 3, location: 0.25 },
    };
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: vi.fn(async () => ({ status: 'no-op' as const, revision: 0 })),
      snapshot: () => snapshot([savedDocument], '/docs/saved.pdf'),
      isDocumentOpen: () => false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(async () => {
        throw new Error('not used');
      }),
    });

    expect(workspace.intakeRuntime.isOpen('/docs/saved.pdf')).toBe(false);
  });

  it('routes native surface links through the originating Document Reader Action', async () => {
    let surfaceCallbacks: DocumentSurfaceCallbacks | undefined;
    const dispatch = vi.fn(async () => ({ status: 'committed' as const, revision: 1 }));
    const surface = createControllableSurface('/docs/report.pdf');
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: dispatch,
      snapshot: () => snapshot([], null),
      isDocumentOpen: () => true,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(async ({ callbacks }) => {
        surfaceCallbacks = callbacks;
        return { rendering: surface.rendering, runtime: surface.runtime as never };
      }),
    });

    await workspace.intakeRuntime.open({
      document: { canonicalPath: '/docs/report.pdf', title: 'report.pdf' },
      bytes: new Uint8Array([1]),
      activate: true,
    });
    await surfaceCallbacks?.linkTargetRequested?.({ url: 'https://example.com/report' });

    expect(dispatch).toHaveBeenCalledWith(
      {
        type: 'activateDocumentTarget',
        filePath: '/docs/report.pdf',
        target: { url: 'https://example.com/report' },
      },
      { isCancelled: expect.any(Function) },
    );
  });

  it('reopens a written PDF before changing just the originating tab and routes later actions to its new path', async () => {
    let reader: ReaderActions;
    let originCallbacks: DocumentSurfaceCallbacks | undefined;
    let dirty = true;
    const initialSession = { schemaVersion: 2 as const, activeDocumentPath: null, documents: [] };
    const visualState = {
      filterSettings: PRESETS.default,
      zoomIntent: { kind: 'fit-width' as const },
      rotation: 90,
      viewMode: 'spread' as const,
    };
    const openedPaths: string[] = [];
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action, options) => reader.dispatch(action, options),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (path) => reader?.isDocumentOpen(path) ?? false,
      defaultVisualState: () => visualState,
      createSurface: async ({ filePath, callbacks }) => {
        openedPaths.push(filePath);
        const substitute = createControllableSurface(filePath);
        if (filePath === '/docs/original.pdf') originCallbacks = callbacks;
        return {
          rendering: substitute.rendering,
          runtime: {
            saveSource: 'loaded-source',
            destroy: async () => {
              await substitute.runtime.destroy();
            },
            content: {
              pageCount: 12,
              getData: async () => new Uint8Array([1]),
              getPage: async () => {
                throw new Error('No page handle needed');
              },
              search: async () => [],
              getOutline: async () => [],
              getMetadata: async () => null,
              resolveLinkTarget: async () => null,
              destroy: async () => undefined,
            },
            renderThumbnail: async () => document.createElement('canvas'),
            getAnnotations: () => [],
            editing: {
              state: () => ({ dirty, revision: 1, readOnlyReason: null }),
              exportPdf: async () => new Uint8Array([2]),
              markSaved: () => {
                dirty = false;
              },
            },
          },
        };
      },
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      persist: async () => undefined,
      pdfSaveAdapter: {
        chooseDestination: async () => ({
          token: 'chosen',
          canonicalPath: '/docs/new.pdf',
          title: 'new.pdf',
        }),
        writeDestination: async (_destination, bytes) => bytes,
        releaseDestination: async () => undefined,
      },
    });
    reader.observe(workspace.project);
    await workspace.intakeRuntime.open({
      document: { canonicalPath: '/docs/original.pdf', title: 'original.pdf' },
      bytes: new Uint8Array([1]),
      activate: true,
    });
    await reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/original.pdf',
      readingPosition: { page: 4, location: 0.25 },
    });
    expect(document.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    expect((await reader.dispatch({ type: 'saveDocumentAs' })).status).toBe('committed');
    expect(openedPaths).toEqual(['/docs/original.pdf', '/docs/new.pdf']);
    expect(reader.snapshot().documents).toEqual([
      {
        filePath: '/docs/new.pdf',
        title: 'new.pdf',
        visualState,
        readingPosition: { page: 4, location: 0.25 },
      },
    ]);
    expect(document.querySelector('.tab-title')?.textContent).toBe('new.pdf');
    expect(workspace.activeRenderingState()?.filePath).toBe('/docs/new.pdf');
    await originCallbacks?.zoomIntentRequested({ kind: 'fit-page' });
    expect(reader.snapshot().documents[0].visualState?.zoomIntent).toEqual({
      kind: 'manual',
      scale: 1,
    });
    await originCallbacks?.pageNavigationRequested(5);
    expect(reader.snapshot().documents[0].readingPosition.page).toBe(5);
  });

  it('Save and deliberate reload use disk bytes, retain reading state, and retire old callbacks', async () => {
    let reader: ReaderActions;
    let disk = new Uint8Array([1]);
    let revision = 1;
    let saved = 0;
    const callbacks: DocumentSurfaceCallbacks[] = [];
    const loaded: number[] = [];
    const initialSession = { schemaVersion: 2 as const, activeDocumentPath: null, documents: [] };
    const visualState = {
      filterSettings: PRESETS.default,
      zoomIntent: { kind: 'fit-width' as const },
      rotation: 90,
      viewMode: 'spread' as const,
    };
    const adapter = {
      captureSource: async () => 'source',
      releaseSource: async () => undefined,
      readSource: async () => disk.slice(),
      chooseDestination: async () => null,
      releaseDestination: async () => undefined,
      writeDestination: async () => {
        throw new Error('Unexpected Save As');
      },
      writeOriginal: async (_token: string, bytes: Uint8Array) => {
        disk = bytes.slice();
        return disk.slice();
      },
    };
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action, options) => reader.dispatch(action, options),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (path) => reader?.isDocumentOpen(path) ?? false,
      defaultVisualState: () => visualState,
      pdfSaveAdapter: adapter,
      createSurface: async ({ filePath, bytes, callbacks: events }) => {
        loaded.push(bytes[0]);
        callbacks.push(events);
        const surface = createControllableSurface(filePath);
        surface.runtime.editing =
          bytes[0] === 1
            ? {
                state: () => ({ revision, dirty: revision !== saved, readOnlyReason: null }),
                exportPdf: async () => new Uint8Array([2]),
                markSaved: (value) => {
                  saved = value;
                  events.stateChanged();
                },
              }
            : undefined;
        return surface;
      },
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      pdfSaveAdapter: adapter,
      persist: async () => undefined,
    });
    reader.observe(workspace.project);
    await workspace.intakeRuntime.open({
      document: { canonicalPath: '/docs/original.pdf', title: 'original.pdf' },
      bytes: disk,
      activate: true,
    });
    await reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/original.pdf',
      readingPosition: { page: 4, location: 0.25 },
    });
    document.querySelector<HTMLButtonElement>('.tab-save')?.click();
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Unsaved changes"]')).toBeNull(),
    );
    expect(disk).toEqual(new Uint8Array([2]));
    expect(loaded).toEqual([1, 2]);
    revision = 2;
    disk = new Uint8Array([3]);
    const before = reader.query();
    expect((await reader.dispatch({ type: 'discardAndReloadDocument' })).status).toBe('performed');
    expect(loaded).toEqual([1, 2, 3]);
    expect(before?.isCurrent()).toBe(false);
    await callbacks[0].pageNavigationRequested(9);
    expect(reader.snapshot().documents[0]).toMatchObject({
      readingPosition: { page: 4, location: 0.25 },
      visualState,
    });
    expect(reader.hasUnsavedPdfWork()).toBe(false);
  });

  it('publishes a new Document only after activation succeeds and permits a clean retry', async () => {
    const persist = vi.fn(async () => undefined);
    const documentOpened = vi.fn();
    const reopenDocument = vi.fn(async () => undefined);
    const createdSurfaces = new Map<string, ControllableSurface[]>();
    let candidateAttempts = 0;
    let presentationActive = false;
    let reader: ReaderActions;
    const initialSession = {
      schemaVersion: 2 as const,
      activeDocumentPath: null,
      documents: [],
    };
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action) => reader.dispatch(action),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (filePath) => reader?.isDocumentOpen(filePath) ?? false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(async ({ filePath }) => {
        if (filePath === '/docs/candidate.pdf') candidateAttempts += 1;
        const surface = createControllableSurface(
          filePath,
          filePath === '/docs/render-fails.pdf'
            ? 1
            : filePath === '/docs/candidate.pdf' && candidateAttempts === 1
              ? 2
              : undefined,
        );
        const attempts = createdSurfaces.get(filePath) ?? [];
        attempts.push(surface);
        createdSurfaces.set(filePath, attempts);
        return { rendering: surface.rendering, runtime: surface.runtime as never };
      }),
      documentOpened,
    });
    reader = createReaderActions({
      initialSession,
      projection: {
        ...workspace.projection,
        exitPresentation: async () => {
          const wasActive = presentationActive;
          presentationActive = false;
          return wasActive
            ? async () => {
                presentationActive = true;
              }
            : undefined;
        },
      },
      persist,
      reopenDocument,
    });
    const intake = createDocumentIntake({
      source: {
        describe: async (path) => ({ canonicalPath: path, title: path.split('/').pop() ?? path }),
        read: async () => new Uint8Array([1, 2, 3]),
      },
      runtime: workspace.intakeRuntime,
    });

    await expect(intake.open(['/docs/prior.pdf'])).resolves.toMatchObject({
      opened: 1,
      failed: 0,
    });
    const settledBeforeFailure = reader.snapshot();
    const durableWritesBeforeFailure = persist.mock.calls.length;
    presentationActive = true;

    await expect(intake.open(['/docs/candidate.pdf'])).resolves.toMatchObject({
      opened: 0,
      failed: 1,
    });

    const failedSurface = createdSurfaces.get('/docs/candidate.pdf')?.[0];
    expect(reader.snapshot()).toBe(settledBeforeFailure);
    expect(persist).toHaveBeenCalledTimes(durableWritesBeforeFailure);
    expect(workspace.intakeRuntime.isOpen('/docs/candidate.pdf')).toBe(false);
    expect(reader.query('/docs/candidate.pdf')).toBeNull();
    expect(workspace.activeRenderingState()?.filePath).toBe('/docs/prior.pdf');
    expect(presentationActive).toBe(true);
    expect(createdSurfaces.get('/docs/prior.pdf')?.[0]?.visible()).toBe(true);
    expect(failedSurface?.visible()).toBe(false);
    expect(failedSurface?.rendering.destroy).toHaveBeenCalledOnce();
    expect(failedSurface?.runtime.destroy).toHaveBeenCalledOnce();
    expect(documentOpened).toHaveBeenCalledTimes(1);
    await expect(reader.dispatch({ type: 'reopenLastClosedDocument' })).resolves.toMatchObject({
      status: 'no-op',
    });
    expect(reopenDocument).not.toHaveBeenCalled();

    await expect(intake.open(['/docs/candidate.pdf'])).resolves.toMatchObject({
      opened: 1,
      failed: 0,
    });

    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/candidate.pdf',
      documents: [{ filePath: '/docs/prior.pdf' }, { filePath: '/docs/candidate.pdf' }],
    });
    expect(workspace.intakeRuntime.isOpen('/docs/candidate.pdf')).toBe(true);
    expect(workspace.activeRenderingState()?.filePath).toBe('/docs/candidate.pdf');
    expect(presentationActive).toBe(false);
    expect(createdSurfaces.get('/docs/prior.pdf')?.[0]?.visible()).toBe(false);
    expect(createdSurfaces.get('/docs/candidate.pdf')?.[1]?.visible()).toBe(true);
    expect(documentOpened).toHaveBeenCalledTimes(2);

    await expect(intake.open(['/docs/background.pdf'], { activate: false })).resolves.toMatchObject(
      { opened: 1, failed: 0 },
    );

    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/candidate.pdf',
      documents: [
        { filePath: '/docs/prior.pdf' },
        { filePath: '/docs/candidate.pdf' },
        { filePath: '/docs/background.pdf' },
      ],
    });
    expect(workspace.intakeRuntime.isOpen('/docs/background.pdf')).toBe(true);
    expect(reader.query('/docs/background.pdf')).not.toBeNull();
    expect(createdSurfaces.get('/docs/background.pdf')?.[0]?.visible()).toBe(false);
    expect(createdSurfaces.get('/docs/candidate.pdf')?.[1]?.visible()).toBe(true);
    expect(documentOpened).toHaveBeenCalledTimes(3);

    const settledBeforeMixedIntake = reader.snapshot();
    const durableWritesBeforeMixedIntake = persist.mock.calls.length;
    const mixedResult = await intake.open([
      '/docs/render-fails.pdf',
      '/docs/successful-sibling.pdf',
    ]);

    expect(mixedResult.outcomes.map(({ status }) => status)).toEqual(['failed', 'opened']);
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/successful-sibling.pdf',
      documents: [
        { filePath: '/docs/prior.pdf' },
        { filePath: '/docs/candidate.pdf' },
        { filePath: '/docs/background.pdf' },
        { filePath: '/docs/successful-sibling.pdf' },
      ],
    });
    expect(reader.snapshot().revision).toBe(settledBeforeMixedIntake.revision + 1);
    expect(persist).toHaveBeenCalledTimes(durableWritesBeforeMixedIntake + 1);
    expect(workspace.intakeRuntime.isOpen('/docs/render-fails.pdf')).toBe(false);
    expect(reader.query('/docs/render-fails.pdf')).toBeNull();
    expect(
      createdSurfaces.get('/docs/render-fails.pdf')?.[0]?.rendering.destroy,
    ).toHaveBeenCalledOnce();
    expect(
      createdSurfaces.get('/docs/render-fails.pdf')?.[0]?.runtime.destroy,
    ).toHaveBeenCalledOnce();
    expect(createdSurfaces.get('/docs/successful-sibling.pdf')?.[0]?.visible()).toBe(true);
    expect(documentOpened).toHaveBeenCalledTimes(4);
  });

  it('rejects shutdown-aborted provisional intake and disposes a surface that arrives late', async () => {
    let finishSurface: ((surface: DocumentSurface) => void) | undefined;
    const lateSurface = createControllableSurface('/docs/password.pdf');
    const dispatch = vi.fn(async () => ({ status: 'committed' as const, revision: 1 }));
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: dispatch,
      dispatchAcceptedIntakeAction: dispatch,
      snapshot: () => snapshot([], null),
      isDocumentOpen: () => false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(
        () =>
          new Promise<DocumentSurface>((resolve) => {
            finishSurface = resolve;
          }),
      ),
    });
    const cancellation = new AbortController();

    const opening = workspace.intakeRuntime.open({
      document: { canonicalPath: '/docs/password.pdf', title: 'password.pdf' },
      bytes: new Uint8Array([1]),
      activate: false,
      signal: cancellation.signal,
    });
    await vi.waitFor(() => expect(finishSurface).toBeTypeOf('function'));
    cancellation.abort(new Error('shutdown'));
    const earlySettlement = await Promise.race([
      opening.then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20)),
    ]);
    finishSurface?.({ rendering: lateSurface.rendering, runtime: lateSurface.runtime as never });
    await opening.catch(() => undefined);

    expect(earlySettlement).toBe('rejected');
    expect(dispatch).not.toHaveBeenCalled();
    expect(lateSurface.rendering.destroy).toHaveBeenCalledOnce();
    expect(lateSurface.runtime.destroy).toHaveBeenCalledOnce();
  });

  it('keeps a failed saved Document provisional until restoration can retry it', async () => {
    const persist = vi.fn(async () => undefined);
    const documentOpened = vi.fn();
    const savedDocument = {
      filePath: '/docs/saved.pdf',
      title: 'saved.pdf',
      readingPosition: { page: 6, location: 0.25 },
      visualState: {
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'fit-width' as const },
        rotation: 90,
        viewMode: 'continuous' as const,
      },
    };
    const initialSession = {
      schemaVersion: 2 as const,
      activeDocumentPath: savedDocument.filePath,
      documents: [savedDocument],
    };
    let reader: ReaderActions;
    let attempts = 0;
    const surfaces: ControllableSurface[] = [];
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action) => reader.dispatch(action),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (filePath) => reader?.isDocumentOpen(filePath) ?? false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'single',
      }),
      createSurface: vi.fn(async ({ filePath }) => {
        attempts += 1;
        const surface = createControllableSurface(filePath, attempts === 1 ? 2 : undefined);
        surfaces.push(surface);
        return { rendering: surface.rendering, runtime: surface.runtime as never };
      }),
      documentOpened,
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      persist,
    });
    const intake = createDocumentIntake({
      source: {
        describe: async (path) => ({ canonicalPath: path, title: 'saved.pdf' }),
        read: async () => new Uint8Array([1, 2, 3]),
      },
      runtime: {
        ...workspace.intakeRuntime,
        canonicalizeDocumentPaths: async (paths) => {
          const outcome = await reader.canonicalizeDocumentPaths(paths);
          if (outcome.status === 'failure') throw outcome.error;
        },
        setDocumentOrder: () => undefined,
      },
    });
    const settledBeforeFailure = reader.snapshot();

    await expect(intake.restore(initialSession)).resolves.toMatchObject({
      opened: 0,
      failed: 1,
      failedPaths: ['/docs/saved.pdf'],
    });

    expect(reader.snapshot()).toBe(settledBeforeFailure);
    expect(persist).not.toHaveBeenCalled();
    expect(workspace.intakeRuntime.isOpen('/docs/saved.pdf')).toBe(false);
    expect(reader.query('/docs/saved.pdf')).toBeNull();
    expect(surfaces[0]?.rendering.destroy).toHaveBeenCalledOnce();
    expect(surfaces[0]?.runtime.destroy).toHaveBeenCalledOnce();
    expect(documentOpened).not.toHaveBeenCalled();

    await expect(intake.restore(initialSession)).resolves.toMatchObject({
      opened: 1,
      failed: 0,
      failedPaths: [],
    });

    expect(reader.snapshot()).toBe(settledBeforeFailure);
    expect(persist).not.toHaveBeenCalled();
    expect(workspace.intakeRuntime.isOpen('/docs/saved.pdf')).toBe(true);
    expect(reader.query('/docs/saved.pdf')).not.toBeNull();
    expect(surfaces[1]?.visible()).toBe(true);
    expect(documentOpened).not.toHaveBeenCalled();
  });
});

// Compile-time contract: the workspace provides the runtime consumed by Document Intake,
// without exposing a mutable tab/session model.
const acceptsIntakeRuntime = (_runtime: DocumentRuntimeIntake): void => undefined;
void acceptsIntakeRuntime;
