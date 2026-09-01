import { Window } from 'happy-dom';
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
      pageTextCache: new Map(),
      pageSurfaces: new Map(),
      singlePageSurface: null,
      searchQuery: '',
      searchMatches: [],
      activeSearchMatch: null,
    });
    vi.spyOn(viewer, 'renderPage').mockImplementation(async (pageNumber: number) => {
      events.push(`render:${pageNumber}`);
    });

    await viewer.loadPDF(new Uint8Array([1]), 'report.pdf', '/tmp/report.pdf');

    expect(events[0]).toBe('render:1');
  });

  it('makes a large continuous Document scrollable before measuring its final page', async () => {
    const browser = new Window();
    vi.stubGlobal('document', browser.document);
    vi.stubGlobal('window', browser);
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    Object.defineProperty(browser.HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: '',
      })),
    });

    const events: string[] = [];
    const page = {
      getViewport: ({ scale = 1 }: { scale?: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        scale,
      }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getTextContent: async () => ({ items: [] }),
      getAnnotations: async () => [],
    };
    const pdfDocument = {
      numPages: 1_001,
      getPage: vi.fn(async (pageNumber: number) => {
        events.push(`dimensions:${pageNumber}`);
        return page;
      }),
      destroy: vi.fn(),
    };
    getPdfEngine.mockResolvedValue({
      TextLayer: class {
        render = async () => {};
        cancel = vi.fn();
      },
    });

    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    const container = browser.document.createElement('div');
    Object.defineProperties(container, {
      clientHeight: { value: 900 },
      clientWidth: { value: 1_200 },
    });
    const wrapper = browser.document.createElement('div');
    const canvas = browser.document.createElement('canvas');
    const textLayer = browser.document.createElement('div');
    const linkLayer = browser.document.createElement('div');
    const userAnnotationLayer = browser.document.createElement('div');
    wrapper.append(canvas, userAnnotationLayer, textLayer, linkLayer);
    const singlePageSurface = {
      wrapper,
      canvas,
      textLayer,
      linkLayer,
      userAnnotationLayer,
      textLayerTask: null,
      layerEpoch: 0,
      pageNumber: 1,
      viewport: null,
    };
    container.appendChild(wrapper);
    Object.assign(viewer, {
      pdfDoc: pdfDocument,
      container,
      canvas,
      singlePageSurface,
      spreadPageSurface: null,
      state: {
        currentPage: 1,
        totalPages: 1_001,
        zoom: 1,
        rotation: 0,
        fileName: 'large.pdf',
        filePath: '/tmp/large.pdf',
        viewMode: 'single',
      },
      canvasId: 'pdf-canvas',
      currentFilterCSS: '',
      isVisible: true,
      canvases: new Map(),
      pageSurfaces: new Map(),
      renderedPages: new Set(),
      visiblePages: new Set(),
      renderTasks: new Map(),
      pageHeights: new Map(),
      pageWidths: new Map(),
      baseDimensions: new Map([[1, { width: 600, height: 800 }]]),
      offsetArray: [],
      visibleRenderLoop: null,
      queuedVisibleRender: null,
      dimensionRefinementTimer: null,
      dimensionRefinementEpoch: 0,
      pageGap: 20,
      pagePadding: 20,
      renderBufferPages: 2,
      cleanupBufferPages: 5,
      annotations: [],
      searchQuery: '',
      activeSearchMatch: null,
      pendingSelectionHighlights: [],
    });

    await viewer.setViewMode('continuous');
    events.push('scrollable');

    expect(events).not.toContain('dimensions:1001');
    viewer.destroy();
  });

  it('requests and applies an encrypted-document password', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({ style: { width: '' } }),
    });

    let resolveDocument: (document: { numPages: number }) => void = () => {};
    const loadingTask = {
      onPassword: undefined as
        | ((updatePassword: (password: string) => void, reason: number) => void)
        | undefined,
      promise: new Promise<{ numPages: number }>((resolve) => {
        resolveDocument = resolve;
      }),
      destroy: vi.fn(async () => {}),
    };
    getPdfEngine.mockResolvedValue({
      PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
      getDocument: () => loadingTask,
    });

    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    const requestPassword = vi.fn(async () => 'open-sesame');
    Object.assign(viewer, {
      renderTask: null,
      requestPassword,
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
      pageTextCache: new Map(),
      pageSurfaces: new Map(),
      singlePageSurface: null,
      searchQuery: '',
      searchMatches: [],
      activeSearchMatch: null,
    });
    vi.spyOn(viewer, 'renderPage').mockResolvedValue();

    const loadPromise = viewer.loadPDF(new Uint8Array([1]), 'protected.pdf', '/tmp/protected.pdf');
    await vi.waitFor(() => expect(loadingTask.onPassword).toBeTypeOf('function'));
    const updatePassword = vi.fn();
    loadingTask.onPassword?.(updatePassword, 2);
    await vi.waitFor(() => expect(updatePassword).toHaveBeenCalledWith('open-sesame'));
    expect(requestPassword).toHaveBeenCalledWith('protected.pdf', 'incorrect');

    resolveDocument({ numPages: 1 });
    await loadPromise;
  });

  it('searches cached PDF text and resolves outline destinations', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({ style: { width: '' } }),
    });
    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    const getPage = vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: [{ str: pageNumber === 1 ? 'Moon light moon' : 'Night sky' }],
      }),
    }));
    Object.assign(viewer, {
      state: {
        currentPage: 1,
        totalPages: 2,
        zoom: 1,
        rotation: 0,
        fileName: 'book.pdf',
        filePath: '/tmp/book.pdf',
        viewMode: 'single',
      },
      pdfDoc: {
        getPage,
        getOutline: async () => [
          {
            title: 'Second page',
            bold: false,
            italic: false,
            dest: [1],
            url: null,
            items: [],
          },
        ],
      },
      pageTextCache: new Map(),
      pageSurfaces: new Map(),
      singlePageSurface: null,
      searchQuery: '',
      searchMatches: [],
      activeSearchMatch: null,
    });

    const matches = await viewer.searchText('moon');
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.pageOccurrence)).toEqual([0, 1]);
    await expect(viewer.getOutlineItems()).resolves.toEqual([
      expect.objectContaining({ title: 'Second page', pageNumber: 2 }),
    ]);
  });

  it('advances two pages at a time in spread view', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({ style: { width: '' } }),
    });
    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    Object.assign(viewer, {
      state: {
        currentPage: 3,
        totalPages: 8,
        zoom: 1,
        rotation: 0,
        fileName: 'book.pdf',
        filePath: '/tmp/book.pdf',
        viewMode: 'spread',
      },
    });
    const goToPage = vi.spyOn(viewer, 'goToPage').mockResolvedValue();

    await viewer.nextPage();
    expect(goToPage).toHaveBeenCalledWith(5);
  });

  it('includes both spread pages in interactive-layer refreshes', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({ style: { width: '' } }),
    });
    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    const continuousSurface = { pageNumber: 3 };
    const primarySurface = { pageNumber: 5 };
    const companionSurface = { pageNumber: 6 };
    Object.assign(viewer, {
      pageSurfaces: new Map([[3, continuousSurface]]),
      singlePageSurface: primarySurface,
      spreadPageSurface: companionSurface,
    });

    const surfaces = (
      viewer as unknown as {
        getPageSurfaces: () => unknown[];
      }
    ).getPageSurfaces();

    expect(surfaces).toEqual([continuousSurface, primarySurface, companionSurface]);
  });

  it('turns modified wheel input and pinch gestures into anchored zoom', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({ style: { width: '' } }),
    });
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    const zoomAtPoint = vi.fn(async () => {});
    Object.assign(viewer, {
      state: {
        currentPage: 1,
        totalPages: 1,
        zoom: 2,
        rotation: 0,
        fileName: 'book.pdf',
        filePath: '/tmp/book.pdf',
        viewMode: 'single',
      },
      container: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
      pendingWheelDelta: 0,
      wheelZoomRafId: null,
      pinchStartZoom: 2,
      zoomAtPoint,
    });
    const privateViewer = viewer as unknown as {
      handleWheel: (event: WheelEvent) => void;
      handleGestureStart: (event: Event) => void;
      handleGestureChange: (event: Event & { scale: number }) => void;
    };
    const preventDefault = vi.fn();

    privateViewer.handleWheel({
      ctrlKey: true,
      metaKey: false,
      deltaY: -100,
      clientX: 120,
      clientY: 180,
      preventDefault,
    } as unknown as WheelEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(zoomAtPoint).toHaveBeenCalledWith(expect.any(Number), 120, 180);

    privateViewer.handleGestureStart({ preventDefault } as unknown as Event);
    privateViewer.handleGestureChange({
      scale: 1.5,
      preventDefault,
    } as unknown as Event & { scale: number });
    expect(zoomAtPoint).toHaveBeenLastCalledWith(3, 400, 300);
  });

  it('updates annotation notes and emits a persistence snapshot', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({ style: { width: '' } }),
    });
    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    const onAnnotationsChange = vi.fn();
    Object.assign(viewer, {
      annotations: [
        {
          id: 'note-1',
          kind: 'highlight',
          pageNumber: 2,
          rects: [{ x1: 1, y1: 2, x2: 3, y2: 4 }],
          text: 'selected text',
          note: '',
          color: 'yellow',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      pageSurfaces: new Map(),
      singlePageSurface: null,
      spreadPageSurface: null,
      onAnnotationsChange,
    });

    viewer.updateAnnotation('note-1', { note: 'Remember this', color: 'blue' });

    expect(viewer.getAnnotations()[0]).toMatchObject({
      note: 'Remember this',
      color: 'blue',
    });
    expect(onAnnotationsChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'note-1', note: 'Remember this' }),
    ]);
  });
});
