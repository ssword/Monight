import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

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

  // Continuous scroll properties
  private canvases: Map<number, HTMLCanvasElement> = new Map();
  private scrollContainer: HTMLDivElement | null = null;
  private visiblePages: Set<number> = new Set();
  private renderTasks: Map<number, RenderTask> = new Map();
  private pageHeights: Map<number, number> = new Map();
  private pageWidths: Map<number, number> = new Map();
  private scrollRafId: number | null = null;
  private readonly pageGap = 20;
  private readonly pagePadding = 20;
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

      // Set canvas dimensions with device pixel ratio for sharp rendering
      const context = this.canvas.getContext('2d');
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

      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
      this.canvas.style.width = `${pageWidth}px`;
      this.canvas.style.height = `${pageHeight}px`;

      outputScale.sx = canvasWidth / pageWidth;
      outputScale.sy = canvasHeight / pageHeight;

      // Render page
      this.renderTask = page.render({
        canvasContext: context,
        viewport,
        transform:
          outputScale.sx !== 1 || outputScale.sy !== 1
            ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0]
            : undefined,
      } as unknown as Parameters<PDFPageProxy['render']>[0]);

      await this.renderTask.promise;
      this.renderTask = null;

      // Update state
      this.state.currentPage = pageNum;

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
    const currentPage = this.state.currentPage;
    this.state.zoom = Math.max(0.25, Math.min(zoom, 5.0));

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

    const page = await this.pdfDoc.getPage(this.state.currentPage);
    const viewport = page.getViewport({ scale: 1.0 });
    const containerWidth = this.container.clientWidth - 40; // 20px padding each side

    this.state.zoom = containerWidth / viewport.width;

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
    } else {
      await this.renderPage(this.state.currentPage);
    }
  }

  async fitToPage(): Promise<void> {
    if (!this.pdfDoc || !this.canvas) return;

    const page = await this.pdfDoc.getPage(this.state.currentPage);
    const viewport = page.getViewport({ scale: 1.0 });
    const containerWidth = this.container.clientWidth - 40;
    const containerHeight = this.container.clientHeight - 40;

    const widthScale = containerWidth / viewport.width;
    const heightScale = containerHeight / viewport.height;

    this.state.zoom = Math.min(widthScale, heightScale);

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
    } else {
      await this.renderPage(this.state.currentPage);
    }
  }

  applyFilter(filterCSS: string): void {
    if (this.state.viewMode === 'continuous') {
      // Apply filter to all continuous canvases
      this.canvases.forEach((canvas) => {
        canvas.style.filter = filterCSS;
      });
    } else {
      // Apply filter to single canvas
      if (!this.canvas) return;
      this.canvas.style.filter = filterCSS;
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
      await this.renderVisiblePages();
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

    console.log('Initializing continuous scroll mode...');

    // Hide single-page canvas
    if (this.canvas) {
      this.canvas.style.display = 'none';
    }

    // Create scroll container if it doesn't exist
    if (!this.scrollContainer) {
      this.scrollContainer = document.createElement('div');
      this.scrollContainer.className = 'scroll-wrapper';
      this.container.appendChild(this.scrollContainer);
      console.log('Created scroll-wrapper element');
    }

    // Add continuous-scroll class to container
    this.container.classList.add('continuous-scroll');
    console.log('Added continuous-scroll class to container');

    // Calculate dimensions for all pages
    await this.calculateAllPageDimensions();
    console.log('Calculated page dimensions');

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

    // Remove all continuous canvases
    this.canvases.forEach((canvas) => {
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    });
    this.canvases.clear();

    // Remove scroll container
    if (this.scrollContainer && this.scrollContainer.parentNode) {
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
    this.pageHeights.clear();
    this.pageWidths.clear();
  }

  private async calculateAllPageDimensions(): Promise<void> {
    if (!this.pdfDoc) return;

    for (let pageNum = 1; pageNum <= this.state.totalPages; pageNum++) {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({
        scale: this.state.zoom,
        rotation: this.state.rotation,
      });

      this.pageWidths.set(pageNum, Math.floor(viewport.width));
      this.pageHeights.set(pageNum, Math.floor(viewport.height));
    }

    // Update scroll container height
    this.updateScrollContainerHeight();
  }

  private updateScrollContainerHeight(): void {
    if (!this.scrollContainer) return;

    // Calculate total height needed for all pages
    const pageGap = this.pageGap;
    let totalHeight = this.pagePadding * 2;

    for (let pageNum = 1; pageNum <= this.state.totalPages; pageNum++) {
      const pageHeight = this.pageHeights.get(pageNum) || 0;
      totalHeight += pageHeight;
      if (pageNum < this.state.totalPages) {
        totalHeight += pageGap;
      }
    }

    // Set minimum height to ensure scrolling works
    this.scrollContainer.style.minHeight = `${totalHeight}px`;
    console.log(`Set scroll container min-height to ${totalHeight}px for ${this.state.totalPages} pages`);
  }

  private calculateVisiblePages(): number[] {
    if (!this.scrollContainer) return [];

    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;
    const scrollBottom = scrollTop + viewportHeight;

    const visible: number[] = [];
    let currentY = this.pagePadding;
    const pageGap = this.pageGap;

    for (let pageNum = 1; pageNum <= this.state.totalPages; pageNum++) {
      const pageHeight = this.pageHeights.get(pageNum) || 0;
      const pageTop = currentY;
      const pageBottom = currentY + pageHeight;

      // Check if page is in viewport (with buffer)
      const bufferPages = 1;
      const buffer = (this.pageHeights.get(pageNum) || 0) * bufferPages;

      if (pageBottom + buffer >= scrollTop && pageTop - buffer <= scrollBottom) {
        visible.push(pageNum);
      }

      currentY += pageHeight + pageGap;
    }

    return visible;
  }

  private async renderVisiblePages(forceRender = false): Promise<void> {
    if (!this.pdfDoc || !this.scrollContainer) return;

    const visiblePageNums = this.calculateVisiblePages();
    const newVisiblePages = new Set(visiblePageNums);

    console.log(`Visible pages in continuous mode: ${Array.from(visiblePageNums).join(', ')}`);

    // Ensure at least the first page is rendered if no pages are visible
    if (visiblePageNums.length === 0) {
      visiblePageNums.push(1);
      newVisiblePages.add(1);
    }

    // Render new pages that came into view
    for (const pageNum of visiblePageNums) {
      this.updateCanvasPosition(pageNum);
      if (forceRender || !this.visiblePages.has(pageNum)) {
        await this.renderPageToContinuousCanvas(pageNum);
      }
    }

    // Cleanup pages that are no longer visible
    this.cleanupInvisiblePages(newVisiblePages);

    this.visiblePages = newVisiblePages;

    // Update current page based on scroll position
    this.updateCurrentPageFromScroll();
  }

  private cleanupInvisiblePages(newVisiblePages: Set<number>): void {
    // Remove canvases for pages no longer visible
    this.visiblePages.forEach((pageNum) => {
      if (!newVisiblePages.has(pageNum)) {
        // Cancel render task if any
        const task = this.renderTasks.get(pageNum);
        if (task) {
          task.cancel();
          this.renderTasks.delete(pageNum);
        }

        // Remove canvas
        const canvas = this.canvases.get(pageNum);
        if (canvas && canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
        this.canvases.delete(pageNum);
      }
    });
  }

  private async renderPageToContinuousCanvas(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.scrollContainer) return;

    try {
      // Get page
      const page = await this.pdfDoc.getPage(pageNum);

      // Calculate viewport
      const viewport = page.getViewport({
        scale: this.state.zoom,
        rotation: this.state.rotation,
      });

      // Create canvas if it doesn't exist
      let canvas = this.canvases.get(pageNum);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = `${this.canvasId}-page-${pageNum}`;
        canvas.dataset.pageNum = pageNum.toString();
        canvas.style.display = 'block'; // Explicitly show canvas in continuous mode
        this.canvases.set(pageNum, canvas);

        // Insert canvas at correct position
        this.insertCanvasAtPosition(canvas, pageNum);
      }

      this.updateCanvasPosition(pageNum);

      // Set canvas dimensions
      const context = canvas.getContext('2d');
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

      outputScale.sx = canvasWidth / pageWidth;
      outputScale.sy = canvasHeight / pageHeight;

      // Apply current filter
      const currentFilter = this.canvas?.style.filter || '';
      if (currentFilter) {
        canvas.style.filter = currentFilter;
      }

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
      this.renderTasks.delete(pageNum);

      console.log(`Rendered page ${pageNum} in continuous mode`);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'RenderingCancelledException'
      ) {
        console.log(`Rendering cancelled for page ${pageNum}`);
        return;
      }
      console.error(`Error rendering page ${pageNum}:`, error);
    }
  }

  private insertCanvasAtPosition(canvas: HTMLCanvasElement, pageNum: number): void {
    if (!this.scrollContainer) return;

    // Find the correct position to insert
    const existingCanvases = Array.from(this.scrollContainer.children) as HTMLCanvasElement[];
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
    if (!this.scrollContainer) return;

    const scrollTop = this.container.scrollTop;
    const focusY = scrollTop + this.pagePadding + 1;

    let currentY = this.pagePadding;
    const pageGap = this.pageGap;

    for (let pageNum = 1; pageNum <= this.state.totalPages; pageNum++) {
      const pageHeight = this.pageHeights.get(pageNum) || 0;
      const pageTop = currentY;
      const pageBottom = currentY + pageHeight + pageGap;

      if (focusY >= pageTop && focusY < pageBottom) {
        this.state.currentPage = pageNum;
        return;
      }

      currentY += pageHeight + pageGap;
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
    if (this.pdfDoc) {
      this.pdfDoc.destroy();
    }
    this.pdfDoc = null;
    this.canvas = null;
  }
}
