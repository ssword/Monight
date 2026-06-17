import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import * as pdfjsLib from 'pdfjs-dist';
import { deriveScaledDimensions } from '../lib/dimensions';
import { hasValueChanged } from '../lib/guards';
import {
  buildOffsetArray,
  currentPageAt,
  positionAtPage,
  visiblePageRange,
} from '../lib/scroll-geometry';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface ViewState {
  currentPage: number;
  totalPages: number;
  zoom: number;
  rotation: number;
  fileName: string;
  filePath: string;
  viewMode: 'single' | 'continuous';
}

interface VisibleRenderRequest {
  forceRender: boolean;
  isInitialRender: boolean;
}

// Align canvas size to PDF.js viewer rounding to avoid subpixel blur.
const calcRound = (() => {
  const element = document.createElement('div');
  element.style.width = 'round(down, calc(1.6666666666666665 * 792px), 1px)';
  return element.style.width === 'calc(1320px)' ? Math.fround : (value: number) => value;
})();

const floorToDivide = (value: number, div: number): number => value - (value % div);

const approximateFraction = (x: number): [number, number] => {
  if (Math.floor(x) === x) {
    return [x, 1];
  }

  const xInv = 1 / x;
  const limit = 8;
  if (xInv > limit) {
    return [1, limit];
  }
  if (Math.floor(xInv) === xInv) {
    return [1, xInv];
  }

  const x_ = x > 1 ? xInv : x;
  let a = 0;
  let b = 1;
  let c = 1;
  let d = 1;

  while (true) {
    const p = a + c;
    const q = b + d;
    if (q > limit) {
      break;
    }
    if (x_ <= p / q) {
      c = p;
      d = q;
    } else {
      a = p;
      b = q;
    }
  }

  const left = x_ - a / b;
  const right = c / d - x_;
  if (left < right) {
    return x_ === x ? [a, b] : [b, a];
  }
  return x_ === x ? [c, d] : [d, c];
};

const getOutputScale = (): { sx: number; sy: number } => {
  const pixelRatio = window.devicePixelRatio || 1;
  return { sx: pixelRatio, sy: pixelRatio };
};

export class PDFViewer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private pdfDoc: PDFDocumentProxy | null = null;
  private state: ViewState = {
    currentPage: 1,
    totalPages: 0,
    zoom: 1.0,
    rotation: 0,
    fileName: '',
    filePath: '',
    viewMode: 'single',
  };
  private renderTask: RenderTask | null = null;
  private canvasId: string;
  private currentFilterCSS = '';
  private onPageChange: ((pageNum: number) => void) | null = null;

  // Continuous scroll properties
  private canvases: Map<number, HTMLCanvasElement> = new Map();
  private renderedPages: Set<number> = new Set();
  private scrollContainer: HTMLDivElement | null = null;
  private visiblePages: Set<number> = new Set();
  private renderTasks: Map<number, RenderTask> = new Map();
  private pageHeights: Map<number, number> = new Map();
  private pageWidths: Map<number, number> = new Map();
  private baseDimensions: Map<number, { width: number; height: number }> = new Map();
  private offsetArray: number[] = [];
  private scrollRafId: number | null = null;
  private visibleRenderLoop: Promise<void> | null = null;
  private queuedVisibleRender: VisibleRenderRequest | null = null;
  private readonly pageGap = 20;
  private readonly pagePadding = 20;
  private readonly renderBufferPages = 2;
  private readonly cleanupBufferPages = 5;
  private handleScrollBound: () => void;

  constructor(containerId: string, canvasId: string = 'pdf-canvas') {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element '${containerId}' not found`);
    }
    this.container = container;
    this.canvasId = canvasId;
    this.initializeCanvas();
    this.handleScrollBound = this.handleScroll.bind(this);
  }

  setOnPageChange(handler: ((pageNum: number) => void) | null): void {
    this.onPageChange = handler;
  }

  private initializeCanvas(): void {
    // Create canvas element for PDF rendering
    this.canvas = document.createElement('canvas');
    this.canvas.id = this.canvasId;
    this.container.appendChild(this.canvas);
  }

  async loadPDF(pdfData: Uint8Array, fileName: string, filePath: string): Promise<void> {
    try {
      // Cancel any pending render
      if (this.renderTask) {
        this.renderTask.cancel();
      }

      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      this.pdfDoc = await loadingTask.promise;

      // Update state
      this.state.totalPages = this.pdfDoc.numPages;
      this.state.currentPage = 1;
      this.state.fileName = fileName;
      this.state.filePath = filePath;

      // Cache base dimensions (scale=1, rotation=0) for all pages
      this.baseDimensions.clear();
      for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
        const page = await this.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0, rotation: 0 });
        this.baseDimensions.set(pageNum, {
          width: viewport.width,
          height: viewport.height,
        });
      }

      // Render first page
      await this.renderPage(1);

      console.log(`Loaded PDF: ${fileName} (${this.state.totalPages} pages)`);
    } catch (error) {
      console.error('Error loading PDF:', error);
      throw new Error(
        `Failed to load PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async renderPage(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.canvas) {
      throw new Error('PDF not loaded');
    }

    if (pageNum < 1 || pageNum > this.state.totalPages) {
      throw new Error(`Invalid page number: ${pageNum}`);
    }

    try {
      // Cancel previous render task
      if (this.renderTask) {
        this.renderTask.cancel();
        this.renderTask = null;
      }

      // Get page
      const page: PDFPageProxy = await this.pdfDoc.getPage(pageNum);

      // Calculate viewport with zoom and rotation
      const viewport = page.getViewport({
        scale: this.state.zoom,
        rotation: this.state.rotation,
      });

      const renderCanvas = document.createElement('canvas');
      const context = renderCanvas.getContext('2d', { alpha: false });
      if (!context) {
        throw new Error('Could not get canvas context');
      }

      const outputScale = getOutputScale();
      const sfx = approximateFraction(outputScale.sx);
      const sfy = approximateFraction(outputScale.sy);

      const canvasWidth = floorToDivide(calcRound(viewport.width * outputScale.sx), sfx[0]);
      const canvasHeight = floorToDivide(calcRound(viewport.height * outputScale.sy), sfy[0]);
      const pageWidth = floorToDivide(calcRound(viewport.width), sfx[1]);
      const pageHeight = floorToDivide(calcRound(viewport.height), sfy[1]);

      renderCanvas.width = canvasWidth;
      renderCanvas.height = canvasHeight;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvasWidth, canvasHeight);

      outputScale.sx = canvasWidth / pageWidth;
      outputScale.sy = canvasHeight / pageHeight;

      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform:
          outputScale.sx !== 1 || outputScale.sy !== 1
            ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0]
            : undefined,
      } as unknown as Parameters<PDFPageProxy['render']>[0]);
      this.renderTask = renderTask;

      await renderTask.promise;
      if (this.renderTask !== renderTask || !this.canvas) {
        return;
      }
      this.renderTask = null;

      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
      this.canvas.style.width = `${pageWidth}px`;
      this.canvas.style.height = `${pageHeight}px`;
      const targetContext = this.canvas.getContext('2d', { alpha: false });
      targetContext?.drawImage(renderCanvas, 0, 0);

      // Update state
      const prevPage = this.state.currentPage;
      this.state.currentPage = pageNum;
      if (prevPage !== pageNum) {
        this.onPageChange?.(pageNum);
      }

      console.log(`Rendered page ${pageNum}/${this.state.totalPages}`);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'RenderingCancelledException'
      ) {
        console.log('Rendering cancelled');
        return;
      }
      console.error('Error rendering page:', error);
      throw error;
    }
  }

  async nextPage(): Promise<void> {
    if (this.state.currentPage < this.state.totalPages) {
      await this.renderPage(this.state.currentPage + 1);
    }
  }

  async previousPage(): Promise<void> {
    if (this.state.currentPage > 1) {
      await this.renderPage(this.state.currentPage - 1);
    }
  }

  async goToPage(pageNum: number): Promise<void> {
    await this.renderPage(pageNum);
  }

  async firstPage(): Promise<void> {
    await this.renderPage(1);
  }

  async lastPage(): Promise<void> {
    if (this.pdfDoc) {
      await this.renderPage(this.state.totalPages);
    }
  }

  async rotateClockwise(): Promise<void> {
    this.state.rotation = (this.state.rotation + 90) % 360;

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
    } else {
      await this.renderPage(this.state.currentPage);
    }
  }

  async rotateCounterClockwise(): Promise<void> {
    this.state.rotation = (this.state.rotation - 90 + 360) % 360;

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
    } else {
      await this.renderPage(this.state.currentPage);
    }
  }

  async zoomIn(): Promise<void> {
    const currentPage = this.state.currentPage;
    this.state.zoom = Math.min(this.state.zoom + 0.25, 5.0);

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
      await this.scrollToPage(currentPage);
    } else {
      await this.renderPage(this.state.currentPage);
    }
  }

  async zoomOut(): Promise<void> {
    const currentPage = this.state.currentPage;
    this.state.zoom = Math.max(this.state.zoom - 0.25, 0.25);

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
      await this.scrollToPage(currentPage);
    } else {
      await this.renderPage(this.state.currentPage);
    }
  }

  async setZoom(zoom: number): Promise<void> {
    const clamped = Math.max(0.25, Math.min(zoom, 5.0));
    if (!hasValueChanged(this.state.zoom, clamped)) return;

    const currentPage = this.state.currentPage;
    this.state.zoom = clamped;

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
      await this.scrollToPage(currentPage);
    } else {
      await this.renderPage(this.state.currentPage);
    }
  }

  async fitToWidth(): Promise<void> {
    if (!this.pdfDoc || !this.canvas) return;

    const base = this.baseDimensions.get(this.state.currentPage);
    let baseWidth: number;
    if (base) {
      // Use cached base dimensions — derive the effective width accounting for rotation
      const dims = deriveScaledDimensions({
        baseWidth: base.width,
        baseHeight: base.height,
        zoom: 1.0,
        rotation: this.state.rotation,
      });
      baseWidth = dims.width;
    } else {
      const page = await this.pdfDoc.getPage(this.state.currentPage);
      const viewport = page.getViewport({ scale: 1.0, rotation: this.state.rotation });
      baseWidth = viewport.width;
    }
    const containerWidth = this.container.clientWidth - 40; // 20px padding each side

    this.state.zoom = containerWidth / baseWidth;

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
    } else {
      await this.renderPage(this.state.currentPage);
    }
  }

  async fitToPage(): Promise<void> {
    if (!this.pdfDoc || !this.canvas) return;

    const base = this.baseDimensions.get(this.state.currentPage);
    let baseWidth: number;
    let baseHeight: number;
    if (base) {
      const dims = deriveScaledDimensions({
        baseWidth: base.width,
        baseHeight: base.height,
        zoom: 1.0,
        rotation: this.state.rotation,
      });
      baseWidth = dims.width;
      baseHeight = dims.height;
    } else {
      const page = await this.pdfDoc.getPage(this.state.currentPage);
      const viewport = page.getViewport({ scale: 1.0, rotation: this.state.rotation });
      baseWidth = viewport.width;
      baseHeight = viewport.height;
    }
    const containerWidth = this.container.clientWidth - 40;
    const containerHeight = this.container.clientHeight - 40;

    const widthScale = containerWidth / baseWidth;
    const heightScale = containerHeight / baseHeight;

    this.state.zoom = Math.min(widthScale, heightScale);

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
    } else {
      await this.renderPage(this.state.currentPage);
    }
  }

  applyFilter(filterCSS: string): void {
    this.currentFilterCSS = filterCSS;

    if (this.canvas) {
      this.canvas.style.filter = filterCSS;
    }

    if (this.state.viewMode === 'continuous') {
      // Apply filter to all continuous canvases
      this.canvases.forEach((canvas) => {
        canvas.style.filter = filterCSS;
      });
    }
  }

  getState(): Readonly<ViewState> {
    return { ...this.state };
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  getPdfDocument(): PDFDocumentProxy | null {
    return this.pdfDoc;
  }

  /**
   * Show or hide the entire viewer (both single-page canvas and continuous scroll wrapper)
   */
  setVisible(visible: boolean): void {
    if (this.state.viewMode === 'continuous') {
      // In continuous mode, show/hide the scroll wrapper
      if (this.scrollContainer) {
        this.scrollContainer.style.display = visible ? 'flex' : 'none';
      }
      // Keep single-page canvas hidden
      if (this.canvas) {
        this.canvas.style.display = 'none';
      }
    } else {
      // In single-page mode, show/hide the main canvas
      if (this.canvas) {
        this.canvas.style.display = visible ? 'block' : 'none';
      }
      // Keep scroll wrapper hidden
      if (this.scrollContainer) {
        this.scrollContainer.style.display = 'none';
      }
    }
  }

  async print(): Promise<void> {
    if (!this.pdfDoc) {
      throw new Error('No PDF document loaded');
    }

    try {
      // Get the raw PDF data
      const pdfData = await this.pdfDoc.getData();

      // Create a Blob from the PDF data (convert to regular Uint8Array)
      const blob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' });

      // Create a blob URL
      const blobUrl = URL.createObjectURL(blob);

      // Create a hidden iframe to load the PDF
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.top = '0';
      iframe.style.left = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style.visibility = 'hidden';
      iframe.src = blobUrl;

      document.body.appendChild(iframe);

      // Wait for iframe to load, then print
      iframe.onload = () => {
        try {
          // Focus the iframe and trigger print
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();

          // Clean up after a delay
          setTimeout(() => {
            document.body.removeChild(iframe);
            URL.revokeObjectURL(blobUrl);
          }, 1000);
        } catch (error) {
          console.error('Error triggering print:', error);
          document.body.removeChild(iframe);
          URL.revokeObjectURL(blobUrl);
          throw error;
        }
      };

      // Handle iframe load errors
      iframe.onerror = () => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(blobUrl);
        throw new Error('Failed to load PDF for printing');
      };
    } catch (error) {
      console.error('Error printing PDF:', error);
      throw error;
    }
  }

  // ========== Continuous Scroll Methods ==========

  async setViewMode(mode: 'single' | 'continuous'): Promise<void> {
    if (this.state.viewMode === mode) return;

    const currentPage = this.state.currentPage;
    this.state.viewMode = mode;

    if (mode === 'continuous') {
      await this.initializeContinuousScroll();
      // Wait for layout to settle before rendering
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await this.renderVisiblePages(false, true);
      // Scroll to current page
      await this.scrollToPage(currentPage);
      // Ensure visibility is correct
      this.setVisible(true);
    } else {
      this.cleanupContinuousScroll();
      // Render single page
      await this.renderPage(currentPage);
      // Ensure visibility is correct
      this.setVisible(true);
    }
  }

  private async initializeContinuousScroll(): Promise<void> {
    if (!this.pdfDoc) return;

    // Hide single-page canvas
    if (this.canvas) {
      this.canvas.style.display = 'none';
    }

    // Create scroll container if it doesn't exist
    if (!this.scrollContainer) {
      this.scrollContainer = document.createElement('div');
      this.scrollContainer.className = 'scroll-wrapper';
      this.container.appendChild(this.scrollContainer);
    }

    // Add continuous-scroll class to container
    this.container.classList.add('continuous-scroll');

    // Calculate dimensions for all pages
    await this.calculateAllPageDimensions();

    // Set up scroll listener
    this.container.addEventListener('scroll', this.handleScrollBound);
  }

  private cleanupContinuousScroll(): void {
    // Remove scroll listener
    this.container.removeEventListener('scroll', this.handleScrollBound);

    if (this.scrollRafId !== null) {
      window.cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = null;
    }

    // Cancel all render tasks
    this.renderTasks.forEach((task) => {
      if (task) task.cancel();
    });
    this.renderTasks.clear();
    this.queuedVisibleRender = null;

    // Remove all continuous canvases
    this.canvases.forEach((canvas) => {
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    });
    this.canvases.clear();

    // Remove scroll container
    if (this.scrollContainer?.parentNode) {
      this.scrollContainer.parentNode.removeChild(this.scrollContainer);
      this.scrollContainer = null;
    }

    // Remove continuous-scroll class
    this.container.classList.remove('continuous-scroll');

    // Show single-page canvas
    if (this.canvas) {
      this.canvas.style.display = 'block';
    }

    // Clear state
    this.visiblePages.clear();
    this.renderedPages.clear();
    this.pageHeights.clear();
    this.pageWidths.clear();
    this.baseDimensions.clear();
    this.offsetArray = [];
  }

  private async calculateAllPageDimensions(): Promise<void> {
    if (!this.pdfDoc) return;

    for (let pageNum = 1; pageNum <= this.state.totalPages; pageNum++) {
      const base = this.baseDimensions.get(pageNum);
      if (base) {
        // Derive from cached base dimensions (no page fetch needed)
        const scaled = deriveScaledDimensions({
          baseWidth: base.width,
          baseHeight: base.height,
          zoom: this.state.zoom,
          rotation: this.state.rotation,
        });
        this.pageWidths.set(pageNum, Math.floor(scaled.width));
        this.pageHeights.set(pageNum, Math.floor(scaled.height));
      } else {
        // Fallback: fetch from PDF.js (should only happen if cache wasn't populated)
        const page = await this.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({
          scale: this.state.zoom,
          rotation: this.state.rotation,
        });
        this.pageWidths.set(pageNum, Math.floor(viewport.width));
        this.pageHeights.set(pageNum, Math.floor(viewport.height));
      }
    }

    // Build the cumulative offset array from page heights
    const heights: number[] = [];
    for (let pageNum = 1; pageNum <= this.state.totalPages; pageNum++) {
      heights.push(this.pageHeights.get(pageNum) || 0);
    }
    this.offsetArray = buildOffsetArray(heights, this.pageGap, this.pagePadding);

    // Update scroll container height using the precomputed total
    this.updateScrollContainerHeight();
  }

  private updateScrollContainerHeight(): void {
    if (!this.scrollContainer) return;

    // Total height is the last entry in the offset array
    const totalHeight = this.offsetArray[this.offsetArray.length - 1] || 0;
    this.scrollContainer.style.minHeight = `${totalHeight}px`;
  }

  private calculateVisiblePages(bufferPages = this.renderBufferPages): number[] {
    if (!this.scrollContainer || this.offsetArray.length === 0) return [];

    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;

    // Compute a pixel buffer from the average page height and bufferPages multiplier
    const avgPageHeight =
      this.state.totalPages > 0
        ? (this.offsetArray[this.offsetArray.length - 1] -
            2 * this.pagePadding -
            (this.state.totalPages - 1) * this.pageGap) /
          this.state.totalPages
        : 0;
    const bufferPx = avgPageHeight * bufferPages;

    const [start, end] = visiblePageRange(this.offsetArray, scrollTop, viewportHeight, bufferPx);

    const visible: number[] = [];
    for (let i = start; i <= end; i++) {
      visible.push(i);
    }
    return visible;
  }

  private async renderVisiblePages(forceRender = false, isInitialRender = false): Promise<void> {
    this.queuedVisibleRender = {
      forceRender: (this.queuedVisibleRender?.forceRender ?? false) || forceRender,
      isInitialRender: (this.queuedVisibleRender?.isInitialRender ?? false) || isInitialRender,
    };

    if (this.visibleRenderLoop) {
      return this.visibleRenderLoop;
    }

    this.visibleRenderLoop = this.drainVisibleRenderQueue();
    try {
      await this.visibleRenderLoop;
    } finally {
      this.visibleRenderLoop = null;
    }
  }

  private async drainVisibleRenderQueue(): Promise<void> {
    while (this.queuedVisibleRender) {
      const request = this.queuedVisibleRender;
      this.queuedVisibleRender = null;
      await this.renderVisiblePagesOnce(request.forceRender, request.isInitialRender);
    }
  }

  private async renderVisiblePagesOnce(
    forceRender = false,
    isInitialRender = false,
  ): Promise<void> {
    if (!this.pdfDoc || !this.scrollContainer) return;

    const renderBufferPages = forceRender ? this.cleanupBufferPages : this.renderBufferPages;
    const visiblePageNums = this.calculateVisiblePages(renderBufferPages);
    const pagesToKeep = new Set(this.calculateVisiblePages(this.cleanupBufferPages));

    // On initial render, ensure we render enough pages to fill the viewport
    // This handles cases where layout hasn't settled yet
    if (isInitialRender && visiblePageNums.length < 2) {
      const minInitialPages = Math.min(3, this.state.totalPages);
      for (let i = 1; i <= minInitialPages; i++) {
        if (!visiblePageNums.includes(i)) {
          visiblePageNums.push(i);
        }
        pagesToKeep.add(i);
      }
    }

    // Ensure at least the first page is rendered if no pages are visible
    if (visiblePageNums.length === 0) {
      visiblePageNums.push(1);
      pagesToKeep.add(1);
    }

    if (forceRender) {
      this.renderedPages.clear();
    }

    // Render new pages that came into view
    for (const pageNum of visiblePageNums) {
      this.updateCanvasPosition(pageNum);
      if (forceRender || !this.renderedPages.has(pageNum)) {
        await this.renderPageToContinuousCanvas(pageNum, forceRender);
      }
    }

    // Cleanup pages that are no longer visible
    this.cleanupInvisiblePages(pagesToKeep);

    this.visiblePages = pagesToKeep;

    // Update current page based on scroll position
    this.updateCurrentPageFromScroll();
  }

  private cleanupInvisiblePages(pagesToKeep: Set<number>): void {
    this.renderTasks.forEach((task, pageNum) => {
      if (!pagesToKeep.has(pageNum)) {
        task.cancel();
        this.renderTasks.delete(pageNum);
      }
    });

    this.canvases.forEach((canvas, pageNum) => {
      if (pagesToKeep.has(pageNum)) return;

      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      this.canvases.delete(pageNum);
      this.renderedPages.delete(pageNum);
    });
  }

  private async renderPageToContinuousCanvas(pageNum: number, forceRender = false): Promise<void> {
    if (!this.pdfDoc || !this.scrollContainer) return;

    try {
      const activeTask = this.renderTasks.get(pageNum);
      if (activeTask) {
        if (!forceRender) {
          await activeTask.promise;
          return;
        }
        activeTask.cancel();
        this.renderTasks.delete(pageNum);
      }

      // Get page
      const page = await this.pdfDoc.getPage(pageNum);

      // Calculate viewport
      const viewport = page.getViewport({
        scale: this.state.zoom,
        rotation: this.state.rotation,
      });

      const canvas = document.createElement('canvas');
      canvas.id = `${this.canvasId}-page-${pageNum}`;
      canvas.dataset.pageNum = pageNum.toString();
      canvas.style.display = 'block';

      // Set canvas dimensions
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;

      const outputScale = getOutputScale();
      const sfx = approximateFraction(outputScale.sx);
      const sfy = approximateFraction(outputScale.sy);

      const canvasWidth = floorToDivide(calcRound(viewport.width * outputScale.sx), sfx[0]);
      const canvasHeight = floorToDivide(calcRound(viewport.height * outputScale.sy), sfy[0]);
      const pageWidth = floorToDivide(calcRound(viewport.width), sfx[1]);
      const pageHeight = floorToDivide(calcRound(viewport.height), sfy[1]);

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      canvas.style.width = `${pageWidth}px`;
      canvas.style.height = `${pageHeight}px`;
      canvas.style.top = `${this.getPagePosition(pageNum)}px`;

      outputScale.sx = canvasWidth / pageWidth;
      outputScale.sy = canvasHeight / pageHeight;

      // Apply current filter
      canvas.style.filter = this.currentFilterCSS;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvasWidth, canvasHeight);

      // Cancel previous render task for this page
      const prevTask = this.renderTasks.get(pageNum);
      if (prevTask) {
        prevTask.cancel();
      }

      // Render page
      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform:
          outputScale.sx !== 1 || outputScale.sy !== 1
            ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0]
            : undefined,
      } as unknown as Parameters<PDFPageProxy['render']>[0]);

      this.renderTasks.set(pageNum, renderTask);

      await renderTask.promise;

      if (this.renderTasks.get(pageNum) !== renderTask || !this.scrollContainer) {
        return;
      }

      this.renderTasks.delete(pageNum);

      if (!this.calculateVisiblePages(this.cleanupBufferPages).includes(pageNum)) {
        return;
      }

      const previousCanvas = this.canvases.get(pageNum);
      if (previousCanvas?.parentNode) {
        previousCanvas.parentNode.replaceChild(canvas, previousCanvas);
      } else {
        this.insertCanvasAtPosition(canvas, pageNum);
      }

      this.canvases.set(pageNum, canvas);
      this.renderedPages.add(pageNum);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'RenderingCancelledException'
      ) {
        return;
      }
      console.error(`Error rendering page ${pageNum}:`, error);
    }
  }

  private insertCanvasAtPosition(canvas: HTMLCanvasElement, pageNum: number): void {
    if (!this.scrollContainer) return;

    // Find the correct position to insert
    const existingCanvases = Array.from(
      this.scrollContainer.querySelectorAll('canvas[data-page-num]'),
    ) as HTMLCanvasElement[];
    let inserted = false;

    for (let i = 0; i < existingCanvases.length; i++) {
      const existingPageNum = Number.parseInt(existingCanvases[i].dataset.pageNum || '0', 10);
      if (pageNum < existingPageNum) {
        this.scrollContainer.insertBefore(canvas, existingCanvases[i]);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.scrollContainer.appendChild(canvas);
    }
  }

  private handleScroll(): void {
    if (this.state.viewMode !== 'continuous') return;

    // Throttle scroll events
    if (this.scrollRafId !== null) {
      return;
    }

    this.scrollRafId = window.requestAnimationFrame(() => {
      this.scrollRafId = null;
      void this.renderVisiblePages();
    });
  }

  private updateCurrentPageFromScroll(): void {
    if (!this.scrollContainer || this.offsetArray.length === 0) return;

    const scrollTop = this.container.scrollTop;
    const focusY = scrollTop + this.pagePadding + 1;

    const pageNum = currentPageAt(this.offsetArray, focusY);
    if (this.state.currentPage !== pageNum) {
      this.state.currentPage = pageNum;
      this.onPageChange?.(pageNum);
    }
  }

  async scrollToPage(pageNum: number): Promise<void> {
    if (this.state.viewMode === 'single') {
      await this.goToPage(pageNum);
      return;
    }

    if (!this.scrollContainer) return;

    const targetY = this.getPagePosition(pageNum);
    this.container.scrollTop = Math.max(targetY - this.pagePadding, 0);

    // Ensure the page is rendered
    await this.renderVisiblePages();
  }

  private getPagePosition(pageNum: number): number {
    if (this.offsetArray.length > 0) {
      return positionAtPage(this.offsetArray, pageNum);
    }
    // Fallback for when offset array hasn't been built yet
    let yPos = this.pagePadding;
    const pageGap = this.pageGap;
    for (let i = 1; i < pageNum; i++) {
      yPos += this.pageHeights.get(i) || 0;
      yPos += pageGap;
    }
    return yPos;
  }

  private updateCanvasPosition(pageNum: number): void {
    const canvas = this.canvases.get(pageNum);
    if (!canvas) return;
    canvas.style.top = `${this.getPagePosition(pageNum)}px`;
  }

  destroy(): void {
    // Cleanup continuous scroll if active
    if (this.state.viewMode === 'continuous') {
      this.cleanupContinuousScroll();
    }

    if (this.renderTask) {
      this.renderTask.cancel();
    }
    if (this.canvas?.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    if (this.pdfDoc) {
      this.pdfDoc.destroy();
    }
    this.pdfDoc = null;
    this.canvas = null;
  }
}
