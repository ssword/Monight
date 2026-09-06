import { describe, expect, it, vi } from 'vitest';
import { createInternalDocumentPage } from '../reader/internal-document-page';

const getPdfEngine = vi.hoisted(() => vi.fn());

vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

type ViewerInternals = {
  state: { viewMode: string; currentPage: number };
  calculateAllPageDimensions: () => Promise<void>;
  renderVisiblePages: () => Promise<void>;
};

function internals(viewer: unknown): ViewerInternals {
  return viewer as ViewerInternals;
}

async function makeContinuousViewer(currentPage: number) {
  vi.stubGlobal('document', {
    createElement: () => ({ style: { width: '' } }),
  });
  const { PDFViewer } = await import('../scripts/pdf-viewer');
  const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;

  const baseDimensions = new Map<number, { width: number; height: number }>();
  for (let page = 1; page <= 10; page++) {
    baseDimensions.set(page, { width: 600, height: 800 });
  }

  Object.assign(viewer, {
    content: { pageCount: 10, getPage: vi.fn(async () => createInternalDocumentPage(1, {})) },
    canvas: {},
    container: { clientWidth: 1240, clientHeight: 900 },
    state: {
      currentPage,
      totalPages: 10,
      zoom: 1,
      rotation: 0,
      fileName: 'report.pdf',
      filePath: '/tmp/report.pdf',
      viewMode: 'continuous',
    },
    baseDimensions,
  });

  return viewer;
}

describe('fit operations in continuous mode', () => {
  it.each([
    ['width', (viewer: Awaited<ReturnType<typeof makeContinuousViewer>>) => viewer.fitToWidth()],
    ['page', (viewer: Awaited<ReturnType<typeof makeContinuousViewer>>) => viewer.fitToPage()],
  ])('restores the current page after fitting to %s', async (_mode, applyFit) => {
    const viewer = await makeContinuousViewer(5);
    const order: string[] = [];

    vi.spyOn(internals(viewer), 'calculateAllPageDimensions').mockImplementation(async () => {
      order.push('recalculate');
    });
    vi.spyOn(internals(viewer), 'renderVisiblePages').mockImplementation(async () => {
      order.push('render');
    });
    vi.spyOn(viewer, 'scrollToPage').mockImplementation(async (page) => {
      order.push(`scroll:${page}`);
    });

    await applyFit(viewer);

    expect(order).toEqual(['recalculate', 'render', 'scroll:5']);
  });

  it.each([
    ['fit-width' as const, 2, 1],
    ['fit-page' as const, 1.075, 0.575],
  ])('recalculates %s Zoom Intent for the current viewport', async (kind, wideZoom, narrowZoom) => {
    const viewer = await makeContinuousViewer(5);
    vi.spyOn(internals(viewer), 'calculateAllPageDimensions').mockResolvedValue();
    vi.spyOn(internals(viewer), 'renderVisiblePages').mockResolvedValue();
    vi.spyOn(viewer, 'scrollToPage').mockResolvedValue();

    await viewer.setZoomIntent({ kind });
    expect(viewer.getState().zoom).toBeCloseTo(wideZoom);

    Object.assign(
      (viewer as unknown as { container: { clientWidth: number; clientHeight: number } }).container,
      {
        clientWidth: 640,
        clientHeight: 500,
      },
    );
    await viewer.setZoomIntent({ kind });

    expect(viewer.getState().zoom).toBeCloseTo(narrowZoom);
    expect(viewer.getState().zoomIntent).toEqual({ kind });
  });
});
