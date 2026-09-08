// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentWorkspace, type DocumentSurfaceCallbacks } from '../app/document-workspace';
import {
  captureEmbedPdfReadingPosition,
  createEmbedPdfDocumentSurfaceFactory,
  createEmbedPdfViewerConfig,
  type EmbedPdfViewerRuntime,
  restoreEmbedPdfReadingPositionCoordinates,
} from '../app/embedpdf-document-surface';
import { createDocumentIntake } from '../reader/document-intake';
import { createReaderActions, type ReaderActions } from '../reader/reader-actions';
import { PRESETS } from '../scripts/filters';

const createViewerRuntime = (
  overrides: Partial<EmbedPdfViewerRuntime> = {},
): EmbedPdfViewerRuntime => ({
  open: vi.fn(async () => undefined),
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

  it('opens intake bytes before exposing page navigation and zoom through Document Rendering', async () => {
    let currentPage = 1;
    let zoom = 1;
    let callbacks: DocumentSurfaceCallbacks | undefined;
    const runtime: EmbedPdfViewerRuntime = {
      open: vi.fn(async () => undefined),
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
      setRotation: vi.fn(async () => undefined),
      setViewMode: vi.fn(async () => undefined),
      fitToPage: vi.fn(async () => undefined),
      applyFilter: vi.fn(),
      setVisible: vi.fn(),
      search: vi.fn(async () => []),
      outline: vi.fn(async () => []),
      metadata: vi.fn(async () => ({
        title: 'Report',
        author: null,
        subject: null,
        keywords: [],
        pageCount: 2,
      })),
      resolveLinkTarget: vi.fn(async () => null),
      renderThumbnail: vi.fn(async () => document.createElement('canvas')),
      destroy: vi.fn(async () => undefined),
    };
    const createViewer = vi.fn(async (request) => {
      callbacks = request.callbacks;
      return runtime;
    });
    const factory = createEmbedPdfDocumentSurfaceFactory({ createViewer });
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
    expect(config.stamp).toEqual({ manifests: [], defaultLibrary: false });
    expect(config.disabledCategories).toEqual(
      expect.arrayContaining([
        'annotation',
        'redaction',
        'insert',
        'document-open',
        'document-close',
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
    const runtime = {
      open: vi.fn(async () => undefined),
      pageCount: () => 1,
      currentPage: () => 1,
      currentZoom: () => 1,
      zoomIntent: () => ({ kind: 'manual' as const, scale: 1 }),
      rotation: () => 0,
      viewMode: () => 'single' as const,
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
    } satisfies EmbedPdfViewerRuntime;
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
    await surface.rendering.setViewMode('continuous');
    await surface.rendering.setRotation(90);
    await surface.rendering.setZoomIntent({ kind: 'fit-width' });

    expect(runtime.applyFilter).toHaveBeenCalledWith('brightness(0.8)');
    expect(runtime.setViewMode).toHaveBeenCalledWith('continuous');
    expect(runtime.setRotation).toHaveBeenCalledWith(90);
    expect(runtime.setZoomIntent).toHaveBeenCalledWith({ kind: 'fit-width' });
    expect(() => surface.rendering.setAnnotations([])).toThrow(/read-only/);
    expect(() => surface.rendering.updateAnnotation('annotation-1', {})).toThrow(/read-only/);
    expect(() => surface.rendering.removeAnnotation('annotation-1')).toThrow(/read-only/);
    expect(PRESETS.default).toBeDefined();
  });
});
