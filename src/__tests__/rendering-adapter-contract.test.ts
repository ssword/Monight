import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LoadableDocumentContent } from '../reader/document-content';
import type { DocumentRendering, DocumentRenderingState } from '../reader/document-rendering';
import { createInternalDocumentPage } from '../reader/internal-document-page';

const getPdfEngine = vi.hoisted(() => vi.fn());
vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

interface RenderingHarness {
  readonly rendering: DocumentRendering;
}

function expectRenderingContract(
  name: string,
  createHarness: () => Promise<RenderingHarness>,
): void {
  describe(name, () => {
    it('projects page navigation before exposing the new rendering state', async () => {
      const { rendering } = await createHarness();

      expect(rendering.getState()).toMatchObject({
        currentPage: 1,
        totalPages: 2,
        fileName: 'report.pdf',
        filePath: '/docs/report.pdf',
      });
      await rendering.goToPage(2);

      expect(rendering.getState().currentPage).toBe(2);
      expect(rendering.getReadingPosition()).toEqual({ page: 2, location: 0 });
      rendering.destroy();
    });
  });
}

function createInMemoryRendering(): DocumentRendering {
  let state: DocumentRenderingState = {
    currentPage: 1,
    totalPages: 2,
    zoom: 1,
    zoomIntent: { kind: 'manual', scale: 1 },
    rotation: 0,
    fileName: 'report.pdf',
    filePath: '/docs/report.pdf',
    viewMode: 'single',
  };
  return {
    getState: () => ({ ...state }),
    getScrollPosition: () => 0,
    getReadingPosition: () => ({ page: state.currentPage, location: 0 }),
    async goToPage(pageNumber) {
      state = { ...state, currentPage: pageNumber };
    },
    async goToReadingPosition(position) {
      state = { ...state, currentPage: position.page };
    },
    async setZoomIntent(zoomIntent) {
      state = {
        ...state,
        zoomIntent,
        ...(zoomIntent.kind === 'manual' ? { zoom: zoomIntent.scale } : {}),
      };
    },
    async zoomIn() {},
    async zoomOut() {},
    async setRotation(rotation) {
      state = { ...state, rotation };
    },
    async setViewMode(viewMode) {
      state = { ...state, viewMode };
    },
    async fitToPage() {},
    applyFilter() {},
    setVisible() {},
    async revealSearchMatch() {},
    setSearchQuery() {},
    clearSearch() {},
    setAnnotations() {},
    async addPageNote() {},
    updateAnnotation() {},
    removeAnnotation() {},
    destroy() {},
  };
}

async function createProductionRendering(): Promise<DocumentRendering> {
  const browser = new Window();
  browser.document.body.innerHTML = '<div id="pdf-container"></div>';
  vi.stubGlobal('document', browser.document);
  vi.stubGlobal('window', browser);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Object.defineProperty(browser.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    })),
  });
  const container = browser.document.getElementById('pdf-container');
  if (!container) throw new Error('Rendering contract container was not created');
  Object.defineProperties(container, {
    clientHeight: { value: 800 },
    clientWidth: { value: 600 },
  });
  getPdfEngine.mockResolvedValue({
    TextLayer: class {
      render = async () => undefined;
      cancel = vi.fn();
    },
    AnnotationType: { LINK: 2 },
  });
  const page = (pageNumber: number) => ({
    getViewport: ({ scale = 1 }: { scale?: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
      rotation: 0,
      convertToViewportRectangle: (rect: number[]) => rect,
      convertToPdfPoint: (x: number, y: number) => [x, y],
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    getTextContent: async () => ({ items: [] }),
    getAnnotations: async () => [],
    pageNumber,
  });
  const content: LoadableDocumentContent = {
    pageCount: 2,
    async load() {},
    async getPage(pageNumber) {
      return createInternalDocumentPage(pageNumber, page(pageNumber));
    },
    async getData() {
      return new Uint8Array([1]);
    },
    async search() {
      return [];
    },
    async getOutline() {
      return [];
    },
    async getMetadata() {
      return null;
    },
    async resolveLinkTarget() {
      return null;
    },
    destroy() {},
  };
  const { PDFViewer } = await import('../scripts/pdf-viewer');
  const rendering = new PDFViewer('pdf-container', 'pdf-canvas', { content });
  await rendering.loadPDF(new Uint8Array([1]), 'report.pdf', '/docs/report.pdf');
  return rendering;
}

describe('Rendering adapter contract', () => {
  expectRenderingContract('in-memory adapter', async () => ({
    rendering: createInMemoryRendering(),
  }));
  expectRenderingContract('PDFViewer production adapter', async () => ({
    rendering: await createProductionRendering(),
  }));
});
