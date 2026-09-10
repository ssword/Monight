// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentWorkspace, type DocumentSurfaceCallbacks } from '../app/document-workspace';
import {
  captureEmbedPdfReadingPosition,
  createEmbedPdfDocumentSurfaceFactory,
  createEmbedPdfViewerConfig,
  type EmbedPdfViewerRuntime,
  embedPdfDestinationReadingPosition,
  embedPdfLayoutForViewMode,
  embedPdfLinkTarget,
  embedPdfLinkTargetAtGeometry,
  embedPdfPageNumberForEventPath,
  removeEmbedPdfCommandShortcuts,
  restoreEmbedPdfReadingPositionCoordinates,
} from '../app/embedpdf-document-surface';
import { createDocumentIntake } from '../reader/document-intake';
import { normalizeAnnotationDisplayName } from '../reader/native-pdf-editing';
import { createReaderActions, type ReaderActions } from '../reader/reader-actions';
import { PRESETS } from '../scripts/filters';

const createViewerRuntime = (
  overrides: Partial<EmbedPdfViewerRuntime> = {},
): EmbedPdfViewerRuntime => ({
  open: vi.fn(async () => undefined),
  openSearch: vi.fn(),
  setSearchQuery: vi.fn(),
  clearSearch: vi.fn(),
  revealSearchMatch: vi.fn(async () => undefined),
  pageCount: () => 2,
  currentPage: () => 1,
  currentZoom: () => 1,
  zoomIntent: () => ({ kind: 'manual', scale: 1 }),
  rotation: () => 0,
  viewMode: () => 'single',
  readingPosition: () => ({ page: 1, location: 0 }),
  goToPage: vi.fn(async () => undefined),
  goToReadingPosition: vi.fn(async () => undefined),
  setZoomIntent: vi.fn(async () => undefined),
  zoomIn: vi.fn(async () => undefined),
  zoomOut: vi.fn(async () => undefined),
  setRotation: vi.fn(async () => undefined),
  setViewMode: vi.fn(async () => undefined),
  fitToPage: vi.fn(async () => undefined),
  applyFilter: vi.fn(),
  setVisible: vi.fn(),
  search: vi.fn(async () => []),
  outline: vi.fn(async () => []),
  metadata: vi.fn(async () => null),
  resolveLinkTarget: vi.fn(async () => null),
  renderThumbnail: vi.fn(async () => document.createElement('canvas')),
  destroy: vi.fn(async () => undefined),
  ...overrides,
});

describe('EmbedPDF Document surface', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="pdf-container"></div>';
  });

  it('preserves normalized within-page Reading Position through EmbedPDF scroll geometry', () => {
    const metrics = {
      pageVisibilityMetrics: [
        {
          pageNumber: 2,
          original: { pageY: 150 },
        },
      ],
    };
    const layout = {
      virtualItems: [
        {
          pageLayouts: [{ pageNumber: 2, rotatedHeight: 600 }],
        },
      ],
    };

    expect(captureEmbedPdfReadingPosition(2, metrics, layout)).toEqual({
      page: 2,
      location: 0.25,
    });
    expect(
      restoreEmbedPdfReadingPositionCoordinates({ width: 400, height: 600 }, 0, {
        page: 2,
        location: 0.25,
      }),
    ).toEqual({ x: 0, y: 150 });
    expect(
      restoreEmbedPdfReadingPositionCoordinates({ width: 400, height: 600 }, 1, {
        page: 2,
        location: 0.25,
      }),
    ).toEqual({ x: 100, y: 600 });
  });

  it('maps every retained View Mode to a distinct EmbedPDF layout', () => {
    expect(embedPdfLayoutForViewMode('single')).toEqual({
      scrollStrategy: 'horizontal',
      spreadMode: 'none',
    });
    expect(embedPdfLayoutForViewMode('continuous')).toEqual({
      scrollStrategy: 'vertical',
      spreadMode: 'none',
    });
    expect(embedPdfLayoutForViewMode('spread')).toEqual({
      scrollStrategy: 'horizontal',
      spreadMode: 'odd',
    });
  });

  it('removes EmbedPDF Find shortcuts while preserving the search command', () => {
    const action = vi.fn();
    const command = {
      id: 'panel:toggle-search',
      action,
      shortcuts: ['Ctrl+F', 'Meta+F'],
      categories: ['panel', 'panel-search'],
    };
    const unregisterCommand = vi.fn();
    const registerCommand = vi.fn();

    removeEmbedPdfCommandShortcuts(
      {
        getCommandByShortcut: vi.fn(() => command),
        unregisterCommand,
        registerCommand,
      },
      'panel:toggle-search',
      ['Ctrl+F', 'Meta+F'],
    );

    expect(unregisterCommand).toHaveBeenCalledWith('panel:toggle-search');
    expect(registerCommand).toHaveBeenCalledWith({
      ...command,
      shortcuts: undefined,
    });
    expect(registerCommand.mock.calls[0]?.[0].action).toBe(action);
  });

  it('translates EmbedPDF navigation events into Monight link targets', () => {
    const destination = { pageIndex: 4, zoom: { mode: 0 }, view: [] };

    expect(
      embedPdfLinkTarget(
        {
          type: 'action',
          action: { type: 3, uri: 'https://example.com/report' },
        } as never,
        vi.fn(),
      ),
    ).toEqual({ url: 'https://example.com/report' });
    expect(
      embedPdfLinkTarget({ type: 'destination', destination } as never, () => ({
        page: 5,
        location: 0.25,
      })),
    ).toEqual({ readingPosition: { page: 5, location: 0.25 } });
    expect(
      embedPdfLinkTarget({ type: 'action', action: { type: 0 } } as never, vi.fn()),
    ).toBeNull();
  });

  it('matches a ready-made link hit area within the page that was clicked', () => {
    const firstPageTarget = { type: 'destination', destination: { pageIndex: 2 } };
    const secondPageTarget = { type: 'destination', destination: { pageIndex: 3 } };
    const annotation = (pageIndex: number, target: typeof firstPageTarget) =>
      ({
        object: {
          type: 2,
          pageIndex,
          flags: [],
          rect: { origin: { x: 72, y: 62 }, size: { width: 108, height: 50 } },
          target: target as never,
        },
      }) as never;
    const pagesContainer = document.createElement('div');
    pagesContainer.style.position = 'relative';
    const firstSpread = document.createElement('div');
    firstSpread.style.display = 'flex';
    firstSpread.style.justifyContent = 'center';
    const firstPage = document.createElement('div');
    firstPage.style.position = 'relative';
    const secondSpread = firstSpread.cloneNode() as HTMLDivElement;
    const secondPage = firstPage.cloneNode() as HTMLDivElement;
    const linkHitArea = document.createElement('rect');
    firstSpread.append(firstPage);
    secondSpread.append(secondPage);
    secondPage.append(linkHitArea);
    pagesContainer.append(firstSpread, secondSpread);
    const layout = {
      virtualItems: [
        { pageLayouts: [{ pageNumber: 1 }] },
        { pageLayouts: [{ pageNumber: 3 }] },
        { pageLayouts: [{ pageNumber: 4 }] },
      ],
    };
    const clickedPage = embedPdfPageNumberForEventPath(
      [linkHitArea, secondPage, secondSpread, pagesContainer],
      layout,
      [1, 2],
    );

    expect(clickedPage).toBe(4);
    expect(
      embedPdfLinkTargetAtGeometry(
        [annotation(2, firstPageTarget), annotation(3, secondPageTarget)],
        [{ left: 108, top: 93, width: 162, height: 75 }],
        1.5,
        clickedPage ?? 0,
      ),
    ).toBe(secondPageTarget);
    expect(
      embedPdfLinkTargetAtGeometry(
        [annotation(0, firstPageTarget)],
        [{ left: 0, top: 0, width: 108, height: 50 }],
        1,
        1,
      ),
    ).toBeNull();
  });

  it('preserves an EmbedPDF XYZ destination as normalized Reading Position', () => {
    expect(
      embedPdfDestinationReadingPosition(
        { pageIndex: 4, zoom: { mode: 1, params: { x: 20, y: 600, zoom: 1 } }, view: [] },
        10,
        800,
      ),
    ).toEqual({ page: 5, location: 0.25 });
  });

  it('opens intake bytes before exposing page navigation and zoom through Document Rendering', async () => {
    let currentPage = 1;
    let zoom = 1;
    let callbacks: DocumentSurfaceCallbacks | undefined;
    const runtime = createViewerRuntime({
      pageCount: () => 2,
      currentPage: () => currentPage,
      currentZoom: () => zoom,
      zoomIntent: () => ({ kind: 'manual', scale: zoom }),
      rotation: () => 0,
      viewMode: () => 'single',
      readingPosition: () => ({ page: currentPage, location: 0 }),
      goToPage: vi.fn(async (page) => {
        currentPage = page;
      }),
      goToReadingPosition: vi.fn(async (position) => {
        currentPage = position.page;
      }),
      setZoomIntent: vi.fn(async (intent) => {
        if (intent.kind === 'manual') zoom = intent.scale;
      }),
      zoomIn: vi.fn(async () => {
        zoom += 0.25;
      }),
      zoomOut: vi.fn(async () => {
        zoom -= 0.25;
      }),
      metadata: vi.fn(async () => ({
        title: 'Report',
        author: null,
        subject: null,
        keywords: [],
        pageCount: 2,
      })),
    });
    const createViewer = vi.fn(async (request) => {
      callbacks = request.callbacks;
      return runtime;
    });
    const factory = createEmbedPdfDocumentSurfaceFactory({
      createViewer,
      getAnnotationDisplayName: () => normalizeAnnotationDisplayName('Ada Lovelace'),
    });
    const bytes = new Uint8Array([1, 2, 3]);

    const surface = await factory({
      filePath: '/docs/report.pdf',
      title: 'report.pdf',
      bytes,
      callbacks: {
        readingPositionObserved: vi.fn(),
        readingPositionSettled: vi.fn(),
        stateChanged: vi.fn(),
        pageNavigationRequested: vi.fn(async () => undefined),
        zoomIntentRequested: vi.fn(async () => undefined),
      },
    });

    expect(runtime.open).toHaveBeenCalledWith({
      bytes,
      title: 'report.pdf',
      filePath: '/docs/report.pdf',
      signal: undefined,
    });
    expect(createViewer).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(HTMLElement),
        callbacks: expect.any(Object),
        annotationDisplayName: 'Ada Lovelace',
      }),
    );
    await surface.rendering.goToPage(2);
    await surface.rendering.setZoomIntent({ kind: 'manual', scale: 1.5 });

    expect(surface.rendering.getState()).toMatchObject({
      currentPage: 2,
      totalPages: 2,
      zoom: 1.5,
      fileName: 'report.pdf',
      filePath: '/docs/report.pdf',
    });
    expect(surface.rendering.getReadingPosition()).toEqual({ page: 2, location: 0 });
    expect(callbacks).toBeDefined();
    await expect(
      surface.runtime.content.getMetadata({ isCancelled: () => false }),
    ).resolves.toMatchObject({ title: 'Report', pageCount: 2 });
  });

  it('configures the ready-made viewer as a local, read-only surface', () => {
    const config = createEmbedPdfViewerConfig();

    expect(config.worker).toBe(false);
    expect(config.wasmUrl).toMatch(/^\/embedpdf\/pdfium\.wasm$/);
    expect(config.fonts).toMatchObject({
      ui: { family: 'system-ui, sans-serif', stylesheetUrl: null },
      signature: null,
    });
    expect(config.fontFallback).toMatchObject({ baseUrl: '/embedpdf/fonts' });
    expect(config.annotations).toMatchObject({ autoOpenLinks: false });
    expect(config.stamp).toEqual({ manifests: [], defaultLibrary: false });
    expect(config.disabledCategories).toEqual(
      expect.arrayContaining([
        'annotation',
        'redaction',
        'insert',
        'document-open',
        'document-close',
        'document-print',
        'document-export',
        'document-protect',
      ]),
    );
    expect(config.permissions).toEqual({
      enforceDocumentPermissions: true,
      overrides: {
        modifyContents: false,
        modifyAnnotations: false,
        fillForms: false,
        assembleDocument: false,
      },
    });
    expect(JSON.stringify(config)).not.toMatch(/https?:\/\//);

    const fontLoader = vi.fn(() => null);
    expect(createEmbedPdfViewerConfig(fontLoader).fontFallback).toMatchObject({ fontLoader });
  });

  it('configures newly authored annotations with the selected display name', () => {
    const config = createEmbedPdfViewerConfig(
      undefined,
      true,
      normalizeAnnotationDisplayName('Ada Lovelace'),
    );

    expect(config.annotations).toMatchObject({ annotationAuthor: 'Ada Lovelace' });
  });

  it('keeps Document Intake provisional until the EmbedPDF surface opens', async () => {
    let finishOpen: (() => void) | undefined;
    let surfaceCallbacks: DocumentSurfaceCallbacks | undefined;
    const runtime = createViewerRuntime({
      open: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishOpen = resolve;
          }),
      ),
    });
    const createSurface = createEmbedPdfDocumentSurfaceFactory({
      createViewer: async ({ callbacks }) => {
        surfaceCallbacks = callbacks;
        return runtime;
      },
    });
    const initialSession = {
      schemaVersion: 2 as const,
      activeDocumentPath: null,
      documents: [],
    };
    let reader: ReaderActions;
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
      createSurface,
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      persist: vi.fn(async () => undefined),
    });
    const intake = createDocumentIntake({
      source: {
        describe: async () => ({ canonicalPath: '/docs/report.pdf', title: 'report.pdf' }),
        read: async () => new Uint8Array([1, 2, 3]),
      },
      runtime: workspace.intakeRuntime,
    });

    const opening = intake.open(['/docs/report.pdf']);
    await vi.waitFor(() => expect(finishOpen).toBeTypeOf('function'));

    expect(reader.snapshot().documents).toEqual([]);
    expect(reader.query('/docs/report.pdf')).toBeNull();

    finishOpen?.();
    await expect(opening).resolves.toMatchObject({ opened: 1, failed: 0 });

    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/report.pdf',
      documents: [{ filePath: '/docs/report.pdf', title: 'report.pdf' }],
    });
    expect(reader.query('/docs/report.pdf')).not.toBeNull();
    expect(document.querySelectorAll('.embedpdf-document-surface')).toHaveLength(1);

    await surfaceCallbacks?.rotationRequested?.('clockwise');
    await surfaceCallbacks?.viewModeRequested?.('spread');

    expect(reader.snapshot().documents[0]?.visualState).toMatchObject({
      rotation: 90,
      viewMode: 'spread',
    });
  });

  it('keeps independent Intake outcomes and removes a failed provisional surface', async () => {
    const failedDestroy = vi.fn(async () => undefined);
    const createSurface = createEmbedPdfDocumentSurfaceFactory({
      createViewer: async () =>
        createViewerRuntime({
          open: vi.fn(async ({ title }) => {
            if (title === 'invalid.pdf') throw new Error('invalid PDF');
          }),
          destroy: vi.fn(async () => {
            failedDestroy();
          }),
        }),
    });
    const initialSession = {
      schemaVersion: 2 as const,
      activeDocumentPath: null,
      documents: [],
    };
    let reader: ReaderActions;
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
      createSurface,
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      persist: vi.fn(async () => undefined),
    });
    const intake = createDocumentIntake({
      source: {
        describe: async (path) => ({
          canonicalPath: path,
          title: path.endsWith('invalid.pdf') ? 'invalid.pdf' : 'report.pdf',
        }),
        read: async () => new Uint8Array([1, 2, 3]),
      },
      runtime: workspace.intakeRuntime,
    });

    const result = await intake.open(['/docs/invalid.pdf', '/docs/report.pdf']);

    expect(result).toMatchObject({ opened: 1, failed: 1 });
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/report.pdf',
      documents: [{ filePath: '/docs/report.pdf', title: 'report.pdf' }],
    });
    expect(document.querySelectorAll('.embedpdf-document-surface')).toHaveLength(1);
    expect(failedDestroy).toHaveBeenCalledOnce();
  });

  it('shares one asynchronous teardown across rendering, runtime, and content owners', async () => {
    let finishDestroy: (() => void) | undefined;
    const destroyViewer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDestroy = resolve;
        }),
    );
    const runtime = createViewerRuntime({ destroy: destroyViewer });
    const factory = createEmbedPdfDocumentSurfaceFactory({ createViewer: async () => runtime });
    const surface = await factory({
      filePath: '/docs/report.pdf',
      title: 'report.pdf',
      bytes: new Uint8Array([1]),
      callbacks: {
        readingPositionObserved: vi.fn(),
        readingPositionSettled: vi.fn(),
        stateChanged: vi.fn(),
        pageNavigationRequested: vi.fn(async () => undefined),
        zoomIntentRequested: vi.fn(async () => undefined),
      },
    });

    surface.rendering.destroy();
    const destruction = surface.runtime.destroy();
    let settled = false;
    void destruction.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(destroyViewer).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    finishDestroy?.();
    await destruction;
    await surface.runtime.content.destroy();

    expect(destroyViewer).toHaveBeenCalledOnce();
    expect(document.querySelector('.embedpdf-document-surface')).toBeNull();
  });

  it('captures originating Documents and rejects callbacks and Queries from a closed generation', async () => {
    const callbacks: DocumentSurfaceCallbacks[] = [];
    let finishSearch!: (
      matches: { pageNumber: number; pageOccurrence: number; index: number; excerpt: string }[],
    ) => void;
    const initialSession = { schemaVersion: 2 as const, activeDocumentPath: null, documents: [] };
    let reader: ReaderActions;
    const workspace = createDocumentWorkspace({
      dispatchReaderAction: (action, options) => reader.dispatch(action, options),
      snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
      isDocumentOpen: (path) => reader?.isDocumentOpen(path) ?? false,
      defaultVisualState: () => ({
        filterSettings: PRESETS.default,
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'continuous',
      }),
      createSurface: createEmbedPdfDocumentSurfaceFactory({
        createViewer: async (request) => {
          callbacks.push(request.callbacks);
          return createViewerRuntime({
            search: async () =>
              new Promise((resolve) => {
                finishSearch = resolve;
              }),
            resolveLinkTarget: async (target) =>
              target.readingPosition
                ? {
                    kind: 'page',
                    pageNumber: target.readingPosition.page,
                    location: target.readingPosition.location,
                  }
                : null,
          });
        },
      }),
    });
    reader = createReaderActions({
      initialSession,
      projection: workspace.projection,
      persist: async () => undefined,
    });
    const open = (path: string) =>
      workspace.intakeRuntime.open({
        document: { canonicalPath: path, title: path },
        bytes: new Uint8Array([1]),
        activate: true,
      });
    await open('/docs/first.pdf');
    const query = reader.query('/docs/first.pdf');
    const pendingSearch = query?.search('moon');
    await open('/docs/second.pdf');
    await callbacks[0].linkTargetRequested?.({ readingPosition: { page: 2, location: 0.5 } });
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/second.pdf',
      documents: [
        { filePath: '/docs/first.pdf', readingPosition: { page: 2, location: 0.5 } },
        { filePath: '/docs/second.pdf', readingPosition: { page: 1, location: 0 } },
      ],
    });

    await reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });
    await open('/docs/first.pdf');
    const reopened = reader.snapshot();
    await callbacks[0].linkTargetRequested?.({ readingPosition: { page: 2, location: 0.5 } });
    await callbacks[0].pageNavigationRequested(2);
    callbacks[0].readingPositionSettled({ page: 2, location: 0.8 });
    await callbacks[0].zoomIntentRequested({ kind: 'manual', scale: 4 });
    await callbacks[0].rotationRequested?.('clockwise');
    await callbacks[0].viewModeRequested?.('spread');
    finishSearch([{ pageNumber: 2, pageOccurrence: 0, index: 0, excerpt: 'moon' }]);
    await expect(pendingSearch).resolves.toEqual([]);
    expect(query?.isCurrent()).toBe(false);
    expect(reader.snapshot()).toEqual(reopened);
  });

  it('disposes a provisional viewer when opening the PDF fails', async () => {
    const openError = new Error('invalid PDF');
    const runtime = createViewerRuntime({
      open: vi.fn(async () => {
        throw openError;
      }),
    });
    const factory = createEmbedPdfDocumentSurfaceFactory({ createViewer: async () => runtime });

    await expect(
      factory({
        filePath: '/docs/invalid.pdf',
        title: 'invalid.pdf',
        bytes: new Uint8Array([1]),
        callbacks: {
          readingPositionObserved: vi.fn(),
          readingPositionSettled: vi.fn(),
          stateChanged: vi.fn(),
          pageNavigationRequested: vi.fn(async () => undefined),
          zoomIntentRequested: vi.fn(async () => undefined),
        },
      }),
    ).rejects.toBe(openError);

    expect(runtime.destroy).toHaveBeenCalledOnce();
    expect(document.querySelector('.embedpdf-document-surface')).toBeNull();
  });

  it('disposes a provisional viewer when preparation is cancelled', async () => {
    let finishOpen: (() => void) | undefined;
    const runtime = createViewerRuntime({
      open: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishOpen = resolve;
          }),
      ),
    });
    const factory = createEmbedPdfDocumentSurfaceFactory({ createViewer: async () => runtime });
    const cancellation = new AbortController();
    const opening = factory({
      filePath: '/docs/report.pdf',
      title: 'report.pdf',
      bytes: new Uint8Array([1]),
      signal: cancellation.signal,
      callbacks: {
        readingPositionObserved: vi.fn(),
        readingPositionSettled: vi.fn(),
        stateChanged: vi.fn(),
        pageNavigationRequested: vi.fn(async () => undefined),
        zoomIntentRequested: vi.fn(async () => undefined),
      },
    });
    await vi.waitFor(() => expect(finishOpen).toBeTypeOf('function'));

    cancellation.abort();
    finishOpen?.();

    await expect(opening).rejects.toThrow('Document Intake interrupted');
    expect(runtime.destroy).toHaveBeenCalledOnce();
    expect(document.querySelector('.embedpdf-document-surface')).toBeNull();
  });

  it('keeps Monight Visual State projection available without making the viewer editable', async () => {
    const runtime = createViewerRuntime({ pageCount: () => 1 });
    const factory = createEmbedPdfDocumentSurfaceFactory({ createViewer: async () => runtime });
    const surface = await factory({
      filePath: '/docs/report.pdf',
      title: 'report.pdf',
      bytes: new Uint8Array([1]),
      callbacks: {
        readingPositionObserved: vi.fn(),
        readingPositionSettled: vi.fn(),
        stateChanged: vi.fn(),
        pageNavigationRequested: vi.fn(async () => undefined),
        zoomIntentRequested: vi.fn(async () => undefined),
      },
    });

    surface.rendering.applyFilter('brightness(0.8)');
    surface.rendering.openSearch?.();
    await surface.rendering.setViewMode('continuous');
    await surface.rendering.setRotation(90);
    await surface.rendering.setZoomIntent({ kind: 'fit-width' });

    expect(runtime.applyFilter).toHaveBeenCalledWith('brightness(0.8)');
    expect(runtime.openSearch).toHaveBeenCalledOnce();
    expect(runtime.setViewMode).toHaveBeenCalledWith('continuous');
    expect(runtime.setRotation).toHaveBeenCalledWith(90);
    expect(runtime.setZoomIntent).toHaveBeenCalledWith({ kind: 'fit-width' });
    expect(() => surface.rendering.setAnnotations([])).toThrow(/read-only/);
    expect(() => surface.rendering.updateAnnotation('annotation-1', {})).toThrow(/read-only/);
    expect(() => surface.rendering.removeAnnotation('annotation-1')).toThrow(/read-only/);
    expect(PRESETS.default).toBeDefined();
  });

  it('ignores cancelled and disposed visual projections through the rendering contract', async () => {
    let scale = 1;
    const runtime = createViewerRuntime({
      currentZoom: () => scale,
      zoomIntent: () => ({ kind: 'manual', scale }),
      setZoomIntent: async (intent) => {
        if (intent.kind === 'manual') scale = intent.scale;
      },
    });
    const surface = await createEmbedPdfDocumentSurfaceFactory({
      createViewer: async () => runtime,
    })({
      filePath: '/docs/report.pdf',
      title: 'report.pdf',
      bytes: new Uint8Array([1]),
      callbacks: {
        readingPositionObserved: vi.fn(),
        readingPositionSettled: vi.fn(),
        stateChanged: vi.fn(),
        pageNavigationRequested: async () => {},
        zoomIntentRequested: async () => {},
      },
    });
    await surface.rendering.setZoomIntent(
      { kind: 'manual', scale: 2 },
      { isCancelled: () => true },
    );
    expect(surface.rendering.getState().zoom).toBe(1);
    await surface.runtime.destroy();
    await surface.rendering.setZoomIntent({ kind: 'manual', scale: 3 });
    expect(surface.rendering.getState().zoom).toBe(1);
  });
});
