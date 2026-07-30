import { describe, expect, it, vi } from 'vitest';

const getPdfEngine = vi.hoisted(() => vi.fn());

vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

describe('PDFViewer initial load', () => {
  it('renders page one before requesting dimensions for the remaining pages', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({ style: { width: '' } }),
    });

    const events: string[] = [];
    const pdfDocument = {
      numPages: 3,
      getPage: vi.fn(async (pageNumber: number) => {
        events.push(`dimensions:${pageNumber}`);
        return {
          getViewport: () => ({ width: 600, height: 800 }),
        };
      }),
    };
    getPdfEngine.mockResolvedValue({
      getDocument: () => ({ promise: Promise.resolve(pdfDocument) }),
    });

    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    Object.assign(viewer, {
      renderTask: null,
      state: {
        currentPage: 1,
        totalPages: 0,
        zoom: 1,
        rotation: 0,
        fileName: '',
        filePath: '',
        viewMode: 'single',
      },
      baseDimensions: new Map(),
    });
    vi.spyOn(viewer, 'renderPage').mockImplementation(async (pageNumber: number) => {
      events.push(`render:${pageNumber}`);
    });

    await viewer.loadPDF(new Uint8Array([1]), 'report.pdf', '/tmp/report.pdf');

    expect(events[0]).toBe('render:1');
  });
});
