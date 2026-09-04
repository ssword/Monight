import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';

import type { LoadableDocumentContent } from '../reader/document-content';
import { createInternalDocumentPage } from '../reader/internal-document-page';

const getPdfEngine = vi.hoisted(() => vi.fn());

vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

function installViewerBrowser(
  options: { clientHeight?: number; clientWidth?: number; useGlobalTimers?: boolean } = {},
) {
  const { clientHeight = 800, clientWidth = 600, useGlobalTimers = false } = options;
  const browser = new Window();
  browser.document.body.innerHTML = '<div id="pdf-container"></div>';
  vi.stubGlobal('document', browser.document);
  vi.stubGlobal('window', browser);
  const runFrameImmediately = (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  };
  vi.stubGlobal('requestAnimationFrame', runFrameImmediately);
  Object.defineProperties(browser, {
    requestAnimationFrame: { value: runFrameImmediately },
    cancelAnimationFrame: { value: vi.fn() },
  });
  if (useGlobalTimers) {
    Object.defineProperties(browser, {
      setTimeout: { value: setTimeout },
      clearTimeout: { value: clearTimeout },
    });
  }
  Object.defineProperty(browser.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    })),
  });
  const container = browser.document.getElementById('pdf-container') as HTMLElement | null;
  if (!container) throw new Error('PDF container not created');
  Object.defineProperties(container, {
    clientHeight: { value: clientHeight },
    clientWidth: { value: clientWidth },
  });
  return { browser, container };
}

async function loadViewer(pdfDocument: unknown) {
  getPdfEngine.mockResolvedValue({
    getDocument: () => ({ promise: Promise.resolve(pdfDocument) }),
    TextLayer: class {
      render = async () => {};
      cancel = vi.fn();
    },
    AnnotationType: { LINK: 2 },
  });
  const { PDFViewer } = await import('../scripts/pdf-viewer');
  const viewer = new PDFViewer('pdf-container');
  await viewer.loadPDF(new Uint8Array([1]), 'report.pdf', '/tmp/report.pdf');
  return viewer;
}

describe('PDFViewer initial load', () => {
  it('renders page one before requesting dimensions for the remaining pages', async () => {
    vi.stubGlobal('document', {
      createElement: () => ({ style: { width: '' } }),
    });

    const events: string[] = [];
    let acceptedBytes: Uint8Array | undefined;
    let callerByteLengthDuringAcceptance = -1;
    const pdfDocument = {
      numPages: 3,
      getPage: vi.fn(async (pageNumber: number) => {
        events.push(`dimensions:${pageNumber}`);
        return {
          getViewport: () => ({ width: 600, height: 800 }),
        };
      }),
    };
    const intakeBytes = new Uint8Array([1]);
    const originalBuffer = intakeBytes.buffer;
    const getDocument = vi.fn(({ data }: { data: Uint8Array }) => {
      acceptedBytes = data;
      callerByteLengthDuringAcceptance = intakeBytes.byteLength;
      return { promise: Promise.resolve(pdfDocument) };
    });
    getPdfEngine.mockResolvedValue({ getDocument });

    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const { createPdfDocumentContent } = await import('../reader/pdf-document-content');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    Object.assign(viewer, {
      content: createPdfDocumentContent(),
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
      pageSurfaces: new Map(),
      singlePageSurface: null,
      searchQuery: '',
      searchMatches: [],
      activeSearchMatch: null,
    });
    vi.spyOn(viewer, 'renderPage').mockImplementation(async (pageNumber: number) => {
      events.push(`render:${pageNumber}`);
    });

    await viewer.loadPDF(intakeBytes, 'report.pdf', '/tmp/report.pdf');

    expect(events[0]).toBe('render:1');
    expect(acceptedBytes).toEqual(new Uint8Array([1]));
    expect(callerByteLengthDuringAcceptance).toBe(1);
    expect(acceptedBytes?.buffer).not.toBe(originalBuffer);
    expect(intakeBytes.byteLength).toBe(0);
  });

  it('makes the continuous view of a large Document scrollable before measuring all pages', async () => {
    const { container } = installViewerBrowser({ clientHeight: 900, clientWidth: 1_200 });

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
    const pdfProxy = {
      numPages: 1_001,
      getPage: vi.fn(async (pageNumber: number) => {
        events.push(`dimensions:${pageNumber}`);
        return page;
      }),
      destroy: vi.fn(),
    };
    const viewer = await loadViewer(pdfProxy);

    await viewer.setViewMode('continuous');
    events.push('scrollable');

    const requestedPageCount = new Set(
      events
        .filter((event) => event.startsWith('dimensions:'))
        .map((event) => Number.parseInt(event.slice('dimensions:'.length), 10)),
    ).size;
    const scrollWrapper = container.querySelector('.scroll-wrapper') as unknown as {
      style: { minHeight: string };
    } | null;
    expect(Number.parseInt(scrollWrapper?.style.minHeight ?? '0', 10)).toBeGreaterThan(
      container.clientHeight,
    );
    expect(requestedPageCount).toBeLessThan(20);
    expect(events).not.toContain('dimensions:1001');
    viewer.destroy();
  });

  it('cancels thumbnail generation and rejects its late completion after destroy', async () => {
    installViewerBrowser();

    let renderCount = 0;
    let finishRender: (() => void) | undefined;
    const cancel = vi.fn();
    const page = {
      getViewport: ({ scale = 1 }: { scale?: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
      }),
      render: () => {
        renderCount += 1;
        if (renderCount === 1) return { cancel: vi.fn(), promise: Promise.resolve() };
        return {
          cancel,
          promise: new Promise<void>((resolve) => {
            finishRender = resolve;
          }),
        };
      },
      getTextContent: async () => ({ items: [] }),
      getAnnotations: async () => [],
    };
    const pdfDocument = {
      numPages: 1,
      getPage: vi.fn(async () => page),
      destroy: vi.fn(),
    };
    const viewer = await loadViewer(pdfDocument);

    const thumbnail = viewer.renderThumbnail(1);
    await vi.waitFor(() => expect(finishRender).toBeTypeOf('function'));
    viewer.destroy();
    finishRender?.();

    expect(cancel).toHaveBeenCalledOnce();
    await expect(thumbnail).rejects.toThrow('Document closed');
  });

  it('rejects a page acquired after an injected rendering adapter is destroyed', async () => {
    installViewerBrowser();
    getPdfEngine.mockResolvedValue({
      TextLayer: class {
        render = async () => {};
        cancel = vi.fn();
      },
      AnnotationType: { LINK: 2 },
    });
    const page = {
      getViewport: ({ scale = 1 }: { scale?: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        scale,
      }),
      render: () => ({ cancel: vi.fn(), promise: Promise.resolve() }),
      getTextContent: async () => ({ items: [] }),
      getAnnotations: async () => [],
    };
    let pageCount = 0;
    let pageRequestCount = 0;
    let finishPageRequest:
      | ((page: ReturnType<typeof createInternalDocumentPage>) => void)
      | undefined;
    const content: LoadableDocumentContent = {
      get pageCount() {
        return pageCount;
      },
      load: vi.fn(async () => {
        pageCount = 1;
      }),
      getPage: vi.fn(async (pageNumber: number) => {
        pageRequestCount += 1;
        if (pageRequestCount === 1) return createInternalDocumentPage(pageNumber, page);
        return new Promise<ReturnType<typeof createInternalDocumentPage>>((resolve) => {
          finishPageRequest = resolve;
        });
      }),
      getData: vi.fn(async () => new Uint8Array()),
      search: vi.fn(async () => []),
      getOutline: vi.fn(async () => []),
      getMetadata: vi.fn(async () => null),
      resolveLinkTarget: vi.fn(async () => null),
      destroy: vi.fn(async () => undefined),
    };
    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = new PDFViewer('pdf-container', 'pdf-canvas', { content });
    await viewer.loadPDF(new Uint8Array([1]), 'report.pdf', '/tmp/report.pdf');

    const thumbnail = viewer.renderThumbnail(1);
    await vi.waitFor(() => expect(finishPageRequest).toBeTypeOf('function'));
    viewer.destroy();
    finishPageRequest?.(createInternalDocumentPage(1, page));

    await expect(thumbnail).rejects.toThrow('Document closed');
    expect(content.destroy).not.toHaveBeenCalled();
  });

  it('keeps the existing continuous surface when scroll rendering queues behind a cancelled Reader Action', async () => {
    const { browser, container } = installViewerBrowser();

    let deferNextRender = false;
    let finishRender: (() => void) | undefined;
    const page = {
      getViewport: ({ scale = 1 }: { scale?: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
      }),
      render: () => {
        if (!deferNextRender) return { cancel: vi.fn(), promise: Promise.resolve() };
        deferNextRender = false;
        return {
          cancel: vi.fn(),
          promise: new Promise<void>((resolve) => {
            finishRender = resolve;
          }),
        };
      },
      getTextContent: async () => ({ items: [] }),
      getAnnotations: async () => [],
    };
    const pdfDocument = {
      numPages: 1,
      getPage: vi.fn(async () => page),
      destroy: vi.fn(),
    };
    const viewer = await loadViewer(pdfDocument);
    await viewer.setViewMode('continuous');
    const initialSurface = container?.querySelector(
      '.scroll-wrapper .pdf-page-surface[data-page-num="1"]',
    );
    let cancelled = false;
    deferNextRender = true;

    const zoom = viewer.setZoom(1.5, { isCancelled: () => cancelled });
    await vi.waitFor(() => expect(finishRender).toBeTypeOf('function'));
    container.dispatchEvent(new browser.Event('scroll') as unknown as Event);
    cancelled = true;
    finishRender?.();
    await zoom;

    expect(initialSurface).not.toBeNull();
    expect(container?.querySelector('.scroll-wrapper .pdf-page-surface[data-page-num="1"]')).toBe(
      initialSurface,
    );
    viewer.destroy();
  });

  it('keeps continuous scroll geometry when background refinement is cancelled', async () => {
    vi.useFakeTimers();
    const { container } = installViewerBrowser({
      clientHeight: 100,
      useGlobalTimers: true,
    });

    let finishPageRead: ((page: unknown) => void) | undefined;
    const measuredPage = (height: number) => ({
      getViewport: ({ scale = 1 }: { scale?: number }) => ({
        width: 600 * scale,
        height: height * scale,
      }),
      render: () => ({ cancel: vi.fn(), promise: Promise.resolve() }),
      getTextContent: async () => ({ items: [] }),
      getAnnotations: async () => [],
    });
    const ordinaryPage = measuredPage(800);
    const getPage = vi.fn((pageNumber: number) => {
      if (pageNumber !== 4) return Promise.resolve(ordinaryPage);
      return new Promise((resolve) => {
        finishPageRead = resolve;
      });
    });
    const pdfDocument = { numPages: 4, getPage, destroy: vi.fn() };
    const viewer = await loadViewer(pdfDocument);

    try {
      let cancelled = false;
      await viewer.setViewMode('continuous', { isCancelled: () => cancelled });
      const scrollWrapper = container?.querySelector('.scroll-wrapper') as HTMLElement | null;
      const initialHeight = scrollWrapper?.style.minHeight;
      await vi.advanceTimersByTimeAsync(0);
      expect(getPage).toHaveBeenCalledWith(4);

      cancelled = true;
      finishPageRead?.(measuredPage(1_600));
      await vi.runAllTimersAsync();

      expect(scrollWrapper?.style.minHeight).toBe(initialHeight);
    } finally {
      viewer.destroy();
      vi.useRealTimers();
    }
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
    const { createPdfDocumentContent } = await import('../reader/pdf-document-content');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    const requestPassword = vi.fn(async () => 'open-sesame');
    Object.assign(viewer, {
      content: createPdfDocumentContent({ requestPassword }),
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

  it('guards search match navigation with the current query token', async () => {
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal('window', { requestAnimationFrame });
    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
    let navigationOptions: { isCancelled?: () => boolean } | undefined;
    Object.assign(viewer, {
      searchToken: 1,
      searchQuery: 'moon',
      searchMatches: [],
      activeSearchMatch: null,
      pageSurfaces: new Map(),
      singlePageSurface: null,
      spreadPageSurface: null,
    });
    const goToPage = vi.spyOn(viewer, 'goToPage').mockImplementation(async (...args: unknown[]) => {
      navigationOptions = args[1] as typeof navigationOptions;
      viewer.clearSearch();
    });

    await viewer.revealSearchMatch({
      pageNumber: 2,
      pageOccurrence: 0,
      index: 4,
      excerpt: 'moon',
    });

    expect(goToPage).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ isCancelled: expect.any(Function) }),
    );
    expect(navigationOptions?.isCancelled?.()).toBe(true);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('discards a staged page when navigation is cancelled during rendering', async () => {
    const browser = new Window();
    vi.stubGlobal('document', browser.document);
    vi.stubGlobal('window', browser);
    Object.defineProperty(browser.HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: '',
      })),
    });

    let finishRender: (() => void) | undefined;
    const page = {
      getViewport: ({ scale = 1 }: { scale?: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        scale,
      }),
      render: () => ({
        promise: new Promise<void>((resolve) => {
          finishRender = resolve;
        }),
        cancel: vi.fn(),
      }),
    };
    const { PDFViewer } = await import('../scripts/pdf-viewer');
    const viewer = Object.create(PDFViewer.prototype) as InstanceType<typeof PDFViewer>;
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
    const onPageChange = vi.fn();
    Object.assign(viewer, {
      content: {
        pageCount: 2,
        getPage: vi.fn(async () => createInternalDocumentPage(2, page)),
      },
      canvas,
      singlePageSurface,
      spreadPageSurface: null,
      state: {
        currentPage: 1,
        totalPages: 2,
        zoom: 1,
        rotation: 0,
        fileName: 'book.pdf',
        filePath: '/tmp/book.pdf',
        viewMode: 'single',
      },
      renderTask: null,
      canvasId: 'pdf-canvas',
      currentFilterCSS: '',
      baseDimensions: new Map(),
      onPageChange,
    });
    let cancelled = false;

    const render = viewer.renderPage(2, null, { isCancelled: () => cancelled });
    await vi.waitFor(() => expect(finishRender).toBeTypeOf('function'));
    cancelled = true;
    finishRender?.();
    await render;

    expect(viewer.getState().currentPage).toBe(1);
    expect(singlePageSurface.pageNumber).toBe(1);
    expect(onPageChange).not.toHaveBeenCalled();
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
    const previewZoomAtPoint = vi.fn();
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
        scrollLeft: 0,
        scrollTop: 0,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
      pendingWheelDelta: 0,
      wheelZoomRafId: null,
      pinchStartZoom: 2,
      gestureZoomActive: false,
      gestureBaseZoom: 2,
      gesturePendingZoom: 2,
      gestureSettleTimer: null,
      previewZoomAtPoint,
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
    expect(previewZoomAtPoint).toHaveBeenCalledWith(expect.any(Number), 120, 180);

    privateViewer.handleGestureStart({ preventDefault } as unknown as Event);
    privateViewer.handleGestureChange({
      scale: 1.5,
      preventDefault,
    } as unknown as Event & { scale: number });
    expect(previewZoomAtPoint).toHaveBeenLastCalledWith(3, 400, 300);
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
