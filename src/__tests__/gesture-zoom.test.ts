import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPdfEngine = vi.hoisted(() => vi.fn());
vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

interface StyleBag {
  transform: string;
  transformOrigin: string;
  willChange: string;
  minHeight: string;
  display: string;
  width: string;
  left: string;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PreviewTarget {
  style: StyleBag;
  getBoundingClientRect: () => Rect;
}

const makeStyle = (width = ''): StyleBag => ({
  transform: '',
  transformOrigin: '',
  willChange: '',
  minHeight: '',
  display: '',
  width,
  left: '',
});

const makeContainer = () => ({
  scrollLeft: 0,
  scrollTop: 0,
  clientHeight: 800,
  clientWidth: 600,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 800 }),
});

type Viewer = {
  setZoom: (zoom: number) => Promise<void>;
  state: { zoom: number; viewMode: string; currentPage: number };
  handleWheel: (event: unknown) => void;
  handleGestureStart: (event: unknown) => void;
  handleGestureChange: (event: unknown) => void;
  renderPage: (pageNum: number, expectedRenderGeneration?: number | null) => Promise<void>;
  calculateAllPageDimensions: (expectedRenderGeneration?: number | null) => Promise<void>;
  renderVisiblePages: (
    forceRender?: boolean,
    isInitialRender?: boolean,
    expectedRenderGeneration?: number | null,
  ) => Promise<void>;
  container: ReturnType<typeof makeContainer>;
  scrollContainer: PreviewTarget | null;
  singlePageSurface: { wrapper: PreviewTarget } | null;
  offsetArray: number[];
  pageHeights: Map<number, number>;
  pageWidths: Map<number, number>;
  pageSurfaces: Map<number, unknown>;
  baseDimensions: Map<number, { width: number; height: number }>;
  renderTasks: Map<number, unknown>;
  renderTask: unknown;
};

async function makeViewer(
  viewMode: 'single' | 'continuous',
): Promise<{ viewer: Viewer; setZoom: ReturnType<typeof vi.fn>; preview: StyleBag }> {
  vi.stubGlobal('document', { createElement: () => ({ style: { width: '' } }) });
  const { PDFViewer } = await import('../scripts/pdf-viewer');
  const viewer = Object.create(PDFViewer.prototype) as Viewer;
  const container = makeContainer();
  const scrollStyle = makeStyle();
  const singleStyle = makeStyle('400px');
  const scrollTarget: PreviewTarget = {
    style: scrollStyle,
    getBoundingClientRect: () => ({
      left: 0,
      top: 20 - container.scrollTop,
      width: 600,
      height: 8_000,
    }),
  };
  const singleTarget: PreviewTarget = {
    style: singleStyle,
    getBoundingClientRect: () => ({
      left: 100 - container.scrollLeft,
      top: 20 - container.scrollTop,
      width: 400,
      height: 600,
    }),
  };
  Object.assign(viewer, {
    renderTask: null,
    spreadRenderTask: null,
    state: {
      currentPage: 1,
      totalPages: 10,
      zoom: 1,
      rotation: 0,
      fileName: 'a.pdf',
      filePath: '/a.pdf',
      viewMode,
    },
    container,
    scrollContainer: viewMode === 'continuous' ? scrollTarget : null,
    singlePageSurface: viewMode === 'single' ? { wrapper: singleTarget } : null,
    spreadPageSurface: null,
    offsetArray: [0, 820, 1640, 2460],
    pageHeights: new Map(),
    pageWidths: new Map(),
    pageSurfaces: new Map(),
    baseDimensions: new Map([[1, { width: 400, height: 800 }]]),
    pageGap: 20,
    pagePadding: 20,
    gestureZoomActive: false,
    gestureBaseZoom: 1,
    gesturePendingZoom: 1,
    gestureSettleTimer: null,
    gesturePreviewBaseMinHeight: null,
    renderGeneration: 0,
    pinchStartZoom: 1,
    wheelZoomRafId: null,
    pendingWheelDelta: 0,
    renderTasks: new Map(),
    queuedVisibleRender: null,
  });

  const setZoom = vi.fn(async (zoom: number) => {
    viewer.state.zoom = zoom;
  });
  viewer.setZoom = setZoom as unknown as Viewer['setZoom'];

  return {
    viewer,
    setZoom,
    preview: viewMode === 'continuous' ? scrollStyle : singleStyle,
  };
}

const wheelEvent = (deltaY: number, clientX: number, clientY: number) => ({
  ctrlKey: true,
  metaKey: false,
  deltaY,
  clientX,
  clientY,
  preventDefault: vi.fn(),
});

describe('gesture zoom preview', () => {
  const rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks.length = 0;
    vi.stubGlobal('window', {
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      },
      cancelAnimationFrame: () => {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const flushFrame = () => {
    const pending = rafCallbacks.splice(0, rafCallbacks.length);
    for (const cb of pending) cb(0);
  };

  it('scales via CSS transform during modifier+wheel zoom without re-rendering per frame', async () => {
    const { viewer, setZoom, preview } = await makeViewer('continuous');

    for (let i = 0; i < 5; i++) {
      viewer.handleWheel(wheelEvent(-100, 300, 400));
      flushFrame();
    }

    expect(setZoom).not.toHaveBeenCalled();
    expect(preview.transform).toMatch(/^scale\(/);
    expect(preview.transformOrigin).toBe('0 0');
    const previewedScale = Number(preview.transform.replace(/scale\(|\)/g, ''));
    expect(previewedScale).toBeGreaterThan(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom.mock.calls[0][0]).toBeCloseTo(previewedScale, 5);
    expect(preview.transform).toBe('');
  });

  it('honours Cmd+wheel as well as Ctrl+wheel and ignores unmodified wheel', async () => {
    const { viewer, setZoom, preview } = await makeViewer('single');

    viewer.handleWheel({ ...wheelEvent(-100, 100, 100), ctrlKey: false, metaKey: false });
    flushFrame();
    expect(preview.transform).toBe('');

    viewer.handleWheel({ ...wheelEvent(-100, 100, 100), ctrlKey: false, metaKey: true });
    flushFrame();
    expect(preview.transform).toMatch(/^scale\(/);

    await vi.advanceTimersByTimeAsync(500);
    expect(setZoom).toHaveBeenCalledTimes(1);
  });

  it('runs a single re-render after a pinch settles, no matter how many frames it spans', async () => {
    const { viewer, setZoom, preview } = await makeViewer('continuous');

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    for (const scale of [1.05, 1.2, 1.4, 1.7, 2.0]) {
      viewer.handleGestureChange({ scale, preventDefault: vi.fn() });
      await vi.advanceTimersByTimeAsync(20);
      expect(setZoom).not.toHaveBeenCalled();
    }
    expect(preview.transform).toBe('scale(2)');

    await vi.advanceTimersByTimeAsync(500);
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(setZoom).toHaveBeenCalledWith(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(setZoom).toHaveBeenCalledTimes(1);
  });

  it('dispatches settled gesture zoom through the Reader Action callback', async () => {
    const { viewer, setZoom } = await makeViewer('continuous');
    const onZoomIntentRequest = vi.fn(async () => undefined);
    Object.assign(viewer, { onZoomIntentRequest });

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    viewer.handleGestureChange({ scale: 1.5, preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(500);

    expect(onZoomIntentRequest).toHaveBeenCalledWith({ kind: 'manual', scale: 1.5 });
    expect(setZoom).not.toHaveBeenCalled();
  });

  it('anchors continuous-mode zoom at the pointer position', async () => {
    const { viewer, setZoom } = await makeViewer('continuous');
    viewer.container.scrollTop = 1000;
    viewer.container.scrollLeft = 0;

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    viewer.handleGestureChange({ scale: 2, clientX: 300, clientY: 400, preventDefault: vi.fn() });

    expect(viewer.container.scrollTop).toBeCloseTo(20 + (1000 + 400 - 20) * 2 - 400, 5);

    await vi.advanceTimersByTimeAsync(500);
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(viewer.container.scrollTop).toBeCloseTo(2380, 5);
  });

  it('expands the scroll extent before anchoring near the old boundary', async () => {
    const { viewer, preview } = await makeViewer('continuous');
    preview.minHeight = '2460px';
    let scrollTop = 1000;
    Object.defineProperty(viewer.container, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        const maxScrollTop = Math.max(
          0,
          Number.parseFloat(preview.minHeight || '0') - viewer.container.clientHeight,
        );
        scrollTop = Math.min(Math.max(value, 0), maxScrollTop);
      },
    });

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    viewer.handleGestureChange({ scale: 2, clientX: 300, clientY: 400, preventDefault: vi.fn() });

    expect(preview.minHeight).toBe('4920px');
    expect(scrollTop).toBeCloseTo(2380, 5);
  });

  it('uses the pre-transform offset when shrinking near the new boundary', async () => {
    const { viewer, preview } = await makeViewer('continuous');
    preview.minHeight = '2460px';
    let scrollTop = 1000;
    Object.defineProperty(viewer.container, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        const maxScrollTop = Math.max(
          0,
          Number.parseFloat(preview.minHeight || '0') - viewer.container.clientHeight,
        );
        scrollTop = Math.min(Math.max(value, 0), maxScrollTop);
      },
    });

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    viewer.handleGestureChange({ scale: 0.5, clientX: 300, clientY: 400, preventDefault: vi.fn() });

    expect(preview.minHeight).toBe('1230px');
    expect(scrollTop).toBeCloseTo(310, 5);
  });

  it('anchors single-page zoom at the pointer position', async () => {
    const { viewer, preview } = await makeViewer('single');
    viewer.container.scrollLeft = 200;
    viewer.container.scrollTop = 100;

    viewer.handleWheel(wheelEvent(-Math.log(2) / 0.002, 100, 50));
    flushFrame();

    expect(preview.transform).toBe('scale(2)');
    expect(viewer.container.scrollLeft).toBeCloseTo(200, 5);
    expect(viewer.container.scrollTop).toBeCloseTo(230, 5);
  });

  it('discards a stale settle render when a new gesture starts mid-flight', async () => {
    const { viewer, preview } = await makeViewer('continuous');
    const releases: Array<() => void> = [];
    const setZoom = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    viewer.setZoom = setZoom as unknown as Viewer['setZoom'];

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    viewer.handleGestureChange({ scale: 1.5, preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(500);
    expect(setZoom).toHaveBeenCalledTimes(1);

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    viewer.handleGestureChange({ scale: 0.5, preventDefault: vi.fn() });
    const scrollDuringSecondGesture = viewer.container.scrollTop;
    releases.pop()?.();
    await Promise.resolve();

    expect(viewer.container.scrollTop).toBe(scrollDuringSecondGesture);
    expect(preview.transform).toMatch(/^scale\(/);
  });

  it('does not start a sharp render after an async settle is superseded', async () => {
    const { viewer, preview } = await makeViewer('continuous');
    let releaseLayout: (() => void) | undefined;
    const calculateAllPageDimensions = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseLayout = resolve;
        }),
    );
    const renderVisiblePages = vi.fn(async () => {});
    const scrollToPage = vi.fn(async () => {});
    Object.assign(viewer, {
      calculateAllPageDimensions,
      renderVisiblePages,
      scrollToPage,
    });
    const prototype = Object.getPrototypeOf(viewer) as { setZoom: Viewer['setZoom'] };
    viewer.setZoom = prototype.setZoom.bind(viewer);

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    viewer.handleGestureChange({ scale: 1.5, preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(500);
    expect(viewer.state.zoom).toBe(1.5);
    expect(releaseLayout).toBeTypeOf('function');

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    viewer.handleGestureChange({ scale: 0.5, preventDefault: vi.fn() });
    expect(viewer.state.zoom).toBe(1);

    releaseLayout?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(renderVisiblePages).not.toHaveBeenCalled();
    expect(scrollToPage).not.toHaveBeenCalled();
    expect(viewer.state.zoom).toBe(1);
    expect(preview.transform).toBe('scale(0.5)');
  });

  it('restores continuous geometry before the next preview starts', async () => {
    const { viewer, preview } = await makeViewer('continuous');
    let releaseRender: (() => void) | undefined;
    const prototype = Object.getPrototypeOf(viewer) as {
      setZoom: Viewer['setZoom'];
      calculateAllPageDimensions: Viewer['calculateAllPageDimensions'];
    };
    Object.assign(viewer, {
      pdfDoc: {},
      setZoom: prototype.setZoom.bind(viewer),
      calculateAllPageDimensions: prototype.calculateAllPageDimensions.bind(viewer),
      scheduleDimensionRefinement: vi.fn(),
      renderVisiblePages: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseRender = resolve;
          }),
      ),
    });

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    viewer.handleGestureChange({ scale: 1.5, preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(500);
    expect(viewer.state.zoom).toBe(1.5);
    expect(viewer.pageHeights.get(1)).toBe(1200);
    expect(viewer.offsetArray[viewer.offsetArray.length - 1]).toBe(12_220);

    viewer.handleGestureStart({ preventDefault: vi.fn() });

    expect(viewer.state.zoom).toBe(1);
    expect(viewer.pageHeights.get(1)).toBe(800);
    expect(viewer.offsetArray[viewer.offsetArray.length - 1]).toBe(8_220);
    expect(viewer.scrollContainer?.style.minHeight).toBe('8220px');
    expect(preview.transform).toBe('');

    releaseRender?.();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('does not register a render task after page acquisition is superseded', async () => {
    const { viewer } = await makeViewer('continuous');
    let releasePage: ((page: unknown) => void) | undefined;
    const pageRender = vi.fn();
    const page = {
      getViewport: () => ({ width: 400, height: 800, scale: 1.5 }),
      render: pageRender,
    };
    const surface = {
      wrapper: { style: { top: '', display: '' } },
      canvas: {
        style: { width: '', height: '', filter: '' },
        getContext: () => ({ fillStyle: '', fillRect: vi.fn() }),
      },
    };
    const prototype = Object.getPrototypeOf(viewer) as {
      renderPageToContinuousCanvas: (
        pageNum: number,
        forceRender?: boolean,
        expectedRenderGeneration?: number | null,
      ) => Promise<void>;
      startSurfaceRender: (
        pageNum: number,
        surface: unknown,
        renderCanvas?: unknown,
        expectedRenderGeneration?: number | null,
      ) => Promise<unknown>;
    };
    Object.assign(viewer, {
      pdfDoc: {
        getPage: vi.fn(
          () =>
            new Promise((resolve) => {
              releasePage = resolve;
            }),
        ),
      },
      canvasId: 'test',
      createPageSurface: vi.fn(() => surface),
      configurePageSurface: vi.fn(),
      disposePageSurface: vi.fn(),
      renderInteractiveLayers: vi.fn(async () => {}),
      calculateVisiblePages: vi.fn(() => [1]),
      insertSurfaceAtPosition: vi.fn(),
      state: { ...viewer.state, zoom: 1.5 },
      gestureCommit: { epoch: 1, targetZoom: 1.5, previousZoom: 1 },
      renderGeneration: 1,
    });
    const renderPromise = prototype.renderPageToContinuousCanvas.call(viewer, 1, true, 1);

    await Promise.resolve();
    viewer.handleGestureStart({ preventDefault: vi.fn() });
    releasePage?.(page);
    await renderPromise;

    expect(pageRender).not.toHaveBeenCalled();
    expect(viewer.renderTasks.size).toBe(0);
  });

  it('does not commit stale single-page pixels while layers are still rendering', async () => {
    const { viewer } = await makeViewer('single');
    const drawImage = vi.fn();
    const renderCanvas = {
      width: 0,
      height: 0,
      style: { width: '', height: '', filter: '' },
      getContext: () => ({ fillStyle: '', fillRect: vi.fn() }),
    };
    const visibleCanvas = {
      width: 400,
      height: 800,
      style: { width: '400px', height: '800px' },
      getContext: () => ({ drawImage }),
    };
    let releaseLayers: (() => void) | undefined;
    const renderTask = { promise: Promise.resolve(), cancel: vi.fn() };
    const page = {
      getViewport: () => ({ width: 400, height: 800, scale: 1.5 }),
      render: vi.fn(() => renderTask),
    };
    const stagedSurface = { wrapper: { style: {} } };
    const prototype = Object.getPrototypeOf(viewer) as {
      renderPage: Viewer['renderPage'];
    };
    vi.stubGlobal('document', { createElement: () => renderCanvas });
    Object.assign(viewer, {
      pdfDoc: { getPage: vi.fn(async () => page) },
      canvas: visibleCanvas,
      canvasId: 'test',
      createPageSurface: vi.fn(() => stagedSurface),
      configurePageSurface: vi.fn(),
      disposePageSurface: vi.fn(),
      renderInteractiveLayers: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseLayers = resolve;
          }),
      ),
      renderGeneration: 1,
    });
    const renderPromise = prototype.renderPage.call(viewer, 1, 1);

    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(viewer.renderTask).toBe(null);

    viewer.handleGestureStart({ preventDefault: vi.fn() });
    releaseLayers?.();
    await renderPromise;

    expect(drawImage).not.toHaveBeenCalled();
    expect(renderTask.cancel).not.toHaveBeenCalled();
  });
});
