// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentWorkspace, type DocumentSurface } from '../app/document-workspace';
import type { LoadableDocumentContent } from '../reader/document-content';
import { createInternalDocumentPage } from '../reader/internal-document-page';
import {
  createReaderActions,
  type ReaderActionOptions,
  type ReaderActions,
} from '../reader/reader-actions';
import { PDFViewer } from '../scripts/pdf-viewer';

const getPdfEngine = vi.hoisted(() => vi.fn());

vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

const DOCUMENT_PATH = '/docs/search.pdf';

interface DeferredRender {
  readonly pageNumber: number;
  readonly promise: Promise<void>;
  readonly cancel: ReturnType<typeof vi.fn>;
  resolve(): void;
}

interface DeferredAnnotations {
  readonly pageNumber: number;
  readonly promise: Promise<unknown[]>;
  resolve(): void;
}

const renderedTextLayers: HTMLElement[] = [];
const createdSurfaces: ControlledPdfSurface[] = [];

class ControlledPdfSurface {
  readonly renderStarts: number[] = [];
  private attachedViewer: PDFViewer | null = null;
  private deferredPage: number | null = null;
  private settleDeferredRenderOnCancel = true;
  private deferredRender: DeferredRender | null = null;
  private deferredAnnotationsPage: number | null = null;
  private deferredAnnotations: DeferredAnnotations | null = null;

  get viewer(): PDFViewer {
    if (!this.attachedViewer) throw new Error('PDFViewer was not attached');
    return this.attachedViewer;
  }

  attachViewer(viewer: PDFViewer): void {
    this.attachedViewer = viewer;
  }

  deferNextRender(pageNumber: number, settleOnCancel = true): void {
    this.deferredPage = pageNumber;
    this.settleDeferredRenderOnCancel = settleOnCancel;
  }

  pendingRender(pageNumber: number): DeferredRender | null {
    return this.deferredRender?.pageNumber === pageNumber ? this.deferredRender : null;
  }

  createRenderTask(pageNumber: number): {
    promise: Promise<void>;
    cancel: ReturnType<typeof vi.fn>;
  } {
    this.renderStarts.push(pageNumber);
    if (this.deferredPage !== pageNumber) {
      return { promise: Promise.resolve(), cancel: vi.fn() };
    }

    this.deferredPage = null;
    let resolve!: () => void;
    const promise = new Promise<void>((next) => {
      resolve = next;
    });
    const settleOnCancel = this.settleDeferredRenderOnCancel;
    const deferredRender: DeferredRender = {
      pageNumber,
      promise,
      cancel: vi.fn(() => {
        if (settleOnCancel) resolve();
      }),
      resolve,
    };
    this.deferredRender = deferredRender;
    return deferredRender;
  }

  deferNextAnnotations(pageNumber: number): void {
    this.deferredAnnotationsPage = pageNumber;
  }

  pendingAnnotations(pageNumber: number): DeferredAnnotations | null {
    return this.deferredAnnotations?.pageNumber === pageNumber ? this.deferredAnnotations : null;
  }

  getAnnotations(pageNumber: number): Promise<unknown[]> {
    if (this.deferredAnnotationsPage !== pageNumber) return Promise.resolve([]);
    this.deferredAnnotationsPage = null;
    let resolve!: () => void;
    const promise = new Promise<unknown[]>((next) => {
      resolve = () => next([]);
    });
    const deferredAnnotations = { pageNumber, promise, resolve };
    this.deferredAnnotations = deferredAnnotations;
    return promise;
  }
}

interface SearchNavigationHarness {
  readonly reader: ReaderActions;
  readonly workspace: ReturnType<typeof createDocumentWorkspace>;
  readonly surfaces: ControlledPdfSurface[];
  activeSurface(): ControlledPdfSurface;
}

function createContent(control: ControlledPdfSurface): LoadableDocumentContent {
  const page = (pageNumber: number) => ({
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
      rotation: 0,
      convertToViewportRectangle: (rect: number[]) => rect,
      convertToPdfPoint: (x: number, y: number) => [x, y],
    }),
    render: () => control.createRenderTask(pageNumber),
    getTextContent: async () => ({
      items: [{ str: pageNumber === 1 ? 'sun' : 'moon' }],
    }),
    getAnnotations: () => control.getAnnotations(pageNumber),
    pageNumber,
  });

  return {
    pageCount: 2,
    load: vi.fn(async () => undefined),
    getPage: vi.fn(async (pageNumber: number) =>
      createInternalDocumentPage(pageNumber, page(pageNumber)),
    ),
    getData: vi.fn(async () => new Uint8Array([1])),
    search: vi.fn(async () => []),
    getOutline: vi.fn(async () => []),
    getMetadata: vi.fn(async () => null),
    resolveLinkTarget: vi.fn(async () => null),
    destroy: vi.fn(async () => undefined),
  };
}

async function createHarness(): Promise<SearchNavigationHarness> {
  const surfaces: ControlledPdfSurface[] = [];
  let reader!: ReaderActions;
  const initialSession = {
    schemaVersion: 2 as const,
    activeDocumentPath: null,
    documents: [],
  };
  const createSurface = vi.fn(
    async ({ filePath, title, bytes, callbacks }): Promise<DocumentSurface> => {
      const control = new ControlledPdfSurface();
      const content = createContent(control);
      const viewer = new PDFViewer('pdf-container', `pdf-canvas-${surfaces.length}`, { content });
      control.attachViewer(viewer);
      surfaces.push(control);
      createdSurfaces.push(control);
      viewer.setOnPageChange(() => callbacks.stateChanged());
      viewer.setOnScrollChange(() =>
        callbacks.readingPositionObserved(viewer.getReadingPosition()),
      );
      viewer.setOnScrollSettled(() =>
        callbacks.readingPositionSettled(viewer.getReadingPosition()),
      );
      viewer.setOnPageNavigationRequest(callbacks.pageNavigationRequested);
      viewer.setOnZoomIntentRequest(callbacks.zoomIntentRequested);
      await viewer.loadPDF(bytes, title, filePath);
      return {
        rendering: viewer,
        runtime: {
          content,
          renderThumbnail: (pageNumber, options) => viewer.renderThumbnail(pageNumber, options),
          getAnnotations: () => [],
          destroy: async () => {
            await content.destroy();
          },
        },
      };
    },
  );
  const workspace = createDocumentWorkspace({
    dispatchReaderAction: (action, options?: ReaderActionOptions) =>
      reader.dispatch(action, options),
    snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
    isDocumentOpen: (filePath) => reader?.isDocumentOpen(filePath) ?? false,
    defaultVisualState: () => ({
      filterSettings: {
        brightness: 100,
        grayscale: 0,
        invert: 0,
        sepia: 0,
        hue: 0,
        extraBrightness: 100,
        bgColor: '#ffffff',
      },
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
  await workspace.intakeRuntime.open({
    document: { canonicalPath: DOCUMENT_PATH, title: 'search.pdf' },
    bytes: new Uint8Array([1]),
    activate: true,
  });

  return {
    reader,
    workspace,
    surfaces,
    activeSurface() {
      const surface = surfaces[surfaces.length - 1];
      if (!surface) throw new Error('Search surface was not created');
      return surface;
    },
  };
}

beforeEach(() => {
  renderedTextLayers.length = 0;
  document.body.innerHTML = `
    <div id="tab-container"></div>
    <div id="document-workspace"></div>
    <div id="pdf-container"></div>
  `;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    })),
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn(() => 1),
  });
  getPdfEngine.mockResolvedValue({
    TextLayer: class {
      private readonly container: HTMLElement;
      private readonly items: Array<{ str?: string }>;

      constructor({
        container,
        textContentSource,
      }: {
        container: HTMLElement;
        textContentSource: { items?: Array<{ str?: string }> };
      }) {
        this.container = container;
        this.items = textContentSource.items ?? [];
      }

      render = async () => {
        renderedTextLayers.push(this.container);
        for (const item of this.items) {
          const span = document.createElement('span');
          span.textContent = item.str ?? '';
          this.container.append(span);
        }
      };

      cancel = vi.fn();
    },
    AnnotationType: { LINK: 2 },
  });
});

afterEach(() => {
  for (const surface of createdSurfaces.splice(0)) {
    surface.viewer.destroy();
  }
});

describe('search navigation integration', () => {
  it('cancels search navigation replaced before queued Reader Action work begins', async () => {
    const harness = await createHarness();
    const surface = harness.activeSurface();
    const access = harness.workspace.access(harness.reader.query(DOCUMENT_PATH));
    if (!access) throw new Error('Search access was not created');
    surface.deferNextRender(1);

    const activation = harness.reader.dispatch({
      type: 'activateDocument',
      filePath: DOCUMENT_PATH,
      readingPosition: { page: 1, location: 0 },
    });
    await vi.waitFor(() => expect(surface.pendingRender(1)).not.toBeNull());
    access.presentation.setSearchQuery('moon');
    const navigation = access.presentation.revealSearchMatch({
      pageNumber: 2,
      pageOccurrence: 0,
      index: 0,
      excerpt: 'moon',
    });

    access.presentation.setSearchQuery('sun');
    surface.pendingRender(1)?.resolve();
    await activation;
    await navigation;

    expect(surface.renderStarts.filter((pageNumber) => pageNumber === 2)).toHaveLength(0);
    expect(surface.viewer.getState().currentPage).toBe(1);
    expect(harness.reader.snapshot().documents[0]?.readingPosition).toEqual({
      page: 1,
      location: 0,
    });
  });

  it('discards staged rendering and highlights when search is cleared in flight', async () => {
    const harness = await createHarness();
    const surface = harness.activeSurface();
    const access = harness.workspace.access(harness.reader.query(DOCUMENT_PATH));
    if (!access) throw new Error('Search access was not created');
    surface.deferNextAnnotations(2);
    access.presentation.setSearchQuery('moon');

    const navigation = access.presentation.revealSearchMatch({
      pageNumber: 2,
      pageOccurrence: 0,
      index: 0,
      excerpt: 'moon',
    });
    await vi.waitFor(() => expect(surface.pendingAnnotations(2)).not.toBeNull());
    await vi.waitFor(() =>
      expect(
        renderedTextLayers[renderedTextLayers.length - 1]?.querySelector('.pdf-search-hit-active'),
      ).not.toBeNull(),
    );

    access.presentation.clearSearch();
    surface.pendingAnnotations(2)?.resolve();
    await navigation;

    expect(surface.viewer.getState().currentPage).toBe(1);
    expect(harness.reader.snapshot().documents[0]?.readingPosition).toEqual({
      page: 1,
      location: 0,
    });
    expect(document.querySelector('.pdf-search-hit')).toBeNull();
  });

  it('commits valid search-result navigation and its active highlight', async () => {
    const harness = await createHarness();
    const surface = harness.activeSurface();
    const access = harness.workspace.access(harness.reader.query(DOCUMENT_PATH));
    if (!access) throw new Error('Search access was not created');
    access.presentation.setSearchQuery('moon');

    await access.presentation.revealSearchMatch({
      pageNumber: 2,
      pageOccurrence: 0,
      index: 0,
      excerpt: 'moon',
    });

    expect(surface.viewer.getState().currentPage).toBe(2);
    expect(harness.reader.snapshot().documents[0]?.readingPosition).toEqual({
      page: 2,
      location: 0,
    });
    expect(document.querySelector('.pdf-search-hit-active')?.textContent).toBe('moon');
  });

  it('does not publish late search navigation into a reopened Document generation', async () => {
    const harness = await createHarness();
    const obsoleteSurface = harness.activeSurface();
    const access = harness.workspace.access(harness.reader.query(DOCUMENT_PATH));
    if (!access) throw new Error('Search access was not created');
    obsoleteSurface.deferNextRender(2, false);
    access.presentation.setSearchQuery('moon');
    const navigation = access.presentation.revealSearchMatch({
      pageNumber: 2,
      pageOccurrence: 0,
      index: 0,
      excerpt: 'moon',
    });
    await vi.waitFor(() => expect(obsoleteSurface.pendingRender(2)).not.toBeNull());
    const obsoleteRender = obsoleteSurface.pendingRender(2);
    if (!obsoleteRender) throw new Error('Obsolete render was not captured');

    await harness.reader.dispatch({ type: 'closeDocument', filePath: DOCUMENT_PATH });
    await harness.workspace.intakeRuntime.open({
      document: { canonicalPath: DOCUMENT_PATH, title: 'search.pdf' },
      bytes: new Uint8Array([1]),
      activate: true,
    });
    const reopenedSurface = harness.activeSurface();
    obsoleteRender.resolve();
    await navigation;

    expect(obsoleteRender.cancel).toHaveBeenCalledOnce();
    expect(reopenedSurface).not.toBe(obsoleteSurface);
    expect(reopenedSurface.viewer.getState().currentPage).toBe(1);
    expect(harness.reader.snapshot()).toMatchObject({
      activeDocumentPath: DOCUMENT_PATH,
      documents: [
        {
          filePath: DOCUMENT_PATH,
          readingPosition: { page: 1, location: 0 },
        },
      ],
    });
  });
});
