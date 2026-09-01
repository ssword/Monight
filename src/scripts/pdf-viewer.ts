import { invoke } from '@tauri-apps/api/core';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import { deriveScaledDimensions } from '../lib/dimensions';
import {
  findPageTextMatches,
  type PdfAnnotation,
  type PdfAnnotationColor,
  type PdfAnnotationRect,
  type PdfOutlineItem,
  type PdfSearchMatch,
  type ViewMode,
} from '../lib/document-features';
import { hasValueChanged } from '../lib/guards';
import {
  computeSafeOutputScale,
  DEFAULT_MAX_CANVAS_AREA,
  DEFAULT_MAX_OUTPUT_SCALE_DPR,
} from '../lib/output-scale';
import { getPdfEngine } from '../lib/pdf-engine';
import {
  buildPdfLinkDomAttributes,
  type PdfDestination,
  type PdfLinkTarget,
} from '../lib/pdf-links';
import {
  buildOffsetArray,
  currentPageAt,
  positionAtPage,
  visiblePageRange,
} from '../lib/scroll-geometry';
import type { ReadingPosition, RestorableReadingPosition } from '../reader/reader-actions';
import { captureReadingPosition, restoreReadingPosition } from '../reader/reading-position';

interface ViewState {
  currentPage: number;
  totalPages: number;
  zoom: number;
  rotation: number;
  fileName: string;
  filePath: string;
  viewMode: ViewMode;
}

interface VisibleRenderRequest {
  forceRender: boolean;
  isInitialRender: boolean;
}

type PageViewport = ReturnType<PDFPageProxy['getViewport']>;
type TextLayerTask = TextLayer;

interface LinkAnnotationData {
  annotationType?: number;
  rect?: number[];
  url?: string;
  unsafeUrl?: string;
  dest?: PdfDestination;
}

interface PageSurface {
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  linkLayer: HTMLDivElement;
  userAnnotationLayer: HTMLDivElement;
  textLayerTask: TextLayerTask | null;
  layerEpoch: number;
  pageNumber: number | null;
  viewport: PageViewport | null;
}

interface RawOutlineItem {
  title: string;
  bold: boolean;
  italic: boolean;
  dest: PdfDestination | null;
  url: string | null;
  unsafeUrl?: string;
  items: RawOutlineItem[];
}

interface GestureLikeEvent extends Event {
  scale?: number;
}

interface SelectionHighlightData {
  pageNumber: number;
  rects: PdfAnnotationRect[];
  text: string;
}

export type PdfPasswordRequester = (
  fileName: string,
  reason: 'required' | 'incorrect',
) => Promise<string | null>;

export type AnnotationNoteRequester = (initialValue?: string) => Promise<string | null>;

export interface PDFViewerOptions {
  requestPassword?: PdfPasswordRequester;
  requestAnnotationNote?: AnnotationNoteRequester;
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

const getOutputScale = (
  viewportWidth: number,
  viewportHeight: number,
): { sx: number; sy: number } => {
  const pixelRatio = window.devicePixelRatio || 1;
  return computeSafeOutputScale({
    devicePixelRatio: pixelRatio,
    viewportWidth,
    viewportHeight,
    maxArea: DEFAULT_MAX_CANVAS_AREA,
    maxDpr: DEFAULT_MAX_OUTPUT_SCALE_DPR,
  });
};

const isAbortLikeError = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortException',
  );

export class PDFViewer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private singlePageSurface: PageSurface | null = null;
  private spreadPageSurface: PageSurface | null = null;
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
  private spreadRenderTask: RenderTask | null = null;
  private canvasId: string;
  private currentFilterCSS = '';
  private onPageChange: ((pageNum: number) => void) | null = null;
  private onScrollChange: ((scrollPosition: number) => void) | null = null;
  private onScrollSettled: (() => void) | null = null;
  private onPageNavigationRequest: ((page: number) => Promise<void>) | null = null;
  private onAnnotationsChange: ((annotations: PdfAnnotation[]) => void) | null = null;
  private annotations: PdfAnnotation[] = [];
  private searchQuery = '';
  private searchMatches: PdfSearchMatch[] = [];
  private activeSearchMatch: PdfSearchMatch | null = null;
  private pendingSelectionHighlights: SelectionHighlightData[] = [];
  private readonly pageTextCache = new Map<number, string>();
  private requestPassword?: PdfPasswordRequester;
  private requestAnnotationNote?: AnnotationNoteRequester;
  private readonly linkTargets = new WeakMap<HTMLElement, PdfLinkTarget>();
  private contextMenu: HTMLDivElement | null = null;
  private handleDocumentPointerDownBound: (event: PointerEvent) => void;
  private handleDocumentPointerUpBound: () => void;
  private handleDocumentKeyDownBound: (event: KeyboardEvent) => void;
  private handleSelectionChangeBound: () => void;
  private handleWheelBound: (event: WheelEvent) => void;
  private handleGestureStartBound: (event: Event) => void;
  private handleGestureChangeBound: (event: Event) => void;
  private isPointerDown = false;
  private isVisible = false;
  private wheelZoomRafId: number | null = null;
  private pendingWheelDelta = 0;
  private pinchStartZoom = 1;
  private pinchRenderEpoch = 0;

  // Continuous scroll properties
  private canvases: Map<number, HTMLCanvasElement> = new Map();
  private pageSurfaces: Map<number, PageSurface> = new Map();
  private renderedPages: Set<number> = new Set();
  private scrollContainer: HTMLDivElement | null = null;
  private visiblePages: Set<number> = new Set();
  private renderTasks: Map<number, RenderTask> = new Map();
  private pageHeights: Map<number, number> = new Map();
  private pageWidths: Map<number, number> = new Map();
  private baseDimensions: Map<number, { width: number; height: number }> = new Map();
  private offsetArray: number[] = [];
  private scrollRafId: number | null = null;
  private scrollSettleTimer: number | null = null;
  private visibleRenderLoop: Promise<void> | null = null;
  private queuedVisibleRender: VisibleRenderRequest | null = null;
  private readonly pageGap = 20;
  private readonly pagePadding = 20;
  private readonly renderBufferPages = 2;
  private readonly cleanupBufferPages = 5;
  private handleScrollBound: () => void;
  private isScrollListenerAttached = false;

  constructor(
    containerId: string,
    canvasId: string = 'pdf-canvas',
    options: PDFViewerOptions = {},
  ) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element '${containerId}' not found`);
    }
    this.container = container;
    this.canvasId = canvasId;
    this.requestPassword = options.requestPassword;
    this.requestAnnotationNote = options.requestAnnotationNote;
    this.initializeCanvas();
    this.handleScrollBound = this.handleScroll.bind(this);
    this.handleDocumentPointerDownBound = this.handleDocumentPointerDown.bind(this);
    this.handleDocumentPointerUpBound = this.handleDocumentPointerUp.bind(this);
    this.handleDocumentKeyDownBound = this.handleDocumentKeyDown.bind(this);
    this.handleSelectionChangeBound = this.handleSelectionChange.bind(this);
    this.handleWheelBound = this.handleWheel.bind(this);
    this.handleGestureStartBound = this.handleGestureStart.bind(this);
    this.handleGestureChangeBound = this.handleGestureChange.bind(this);
    document.addEventListener('pointerdown', this.handleDocumentPointerDownBound, true);
    document.addEventListener('pointerup', this.handleDocumentPointerUpBound, true);
    document.addEventListener('keydown', this.handleDocumentKeyDownBound);
    document.addEventListener('selectionchange', this.handleSelectionChangeBound);
  }

  setOnPageChange(handler: ((pageNum: number) => void) | null): void {
    this.onPageChange = handler;
  }

  setOnScrollChange(handler: ((scrollPosition: number) => void) | null): void {
    this.onScrollChange = handler;
  }

  setOnScrollSettled(handler: (() => void) | null): void {
    this.onScrollSettled = handler;
  }

  setOnPageNavigationRequest(handler: ((page: number) => Promise<void>) | null): void {
    this.onPageNavigationRequest = handler;
  }

  setOnAnnotationsChange(handler: ((annotations: PdfAnnotation[]) => void) | null): void {
    this.onAnnotationsChange = handler;
  }

  private initializeCanvas(): void {
    const surface = this.createPageSurface(this.canvasId);
    surface.wrapper.classList.add('spread-primary');
    this.singlePageSurface = surface;
    this.canvas = surface.canvas;
    this.container.appendChild(surface.wrapper);
  }

  private createPageSurface(canvasId: string, pageNum?: number): PageSurface {
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-surface';
    if (pageNum !== undefined) {
      wrapper.dataset.pageNum = pageNum.toString();
    }
    wrapper.addEventListener('contextmenu', (event) => this.handlePageContextMenu(event));

    const canvas = document.createElement('canvas');
    canvas.id = canvasId;
    canvas.style.filter = this.currentFilterCSS;
    if (pageNum !== undefined) {
      canvas.dataset.pageNum = pageNum.toString();
    }

    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    textLayer.addEventListener('mousedown', () => {
      textLayer.classList.add('selecting');
    });

    const linkLayer = document.createElement('div');
    linkLayer.className = 'annotationLayer pdf-link-layer';
    linkLayer.setAttribute('aria-hidden', 'false');

    const userAnnotationLayer = document.createElement('div');
    userAnnotationLayer.className = 'user-annotation-layer';

    wrapper.append(canvas, userAnnotationLayer, textLayer, linkLayer);

    return {
      wrapper,
      canvas,
      textLayer,
      linkLayer,
      userAnnotationLayer,
      textLayerTask: null,
      layerEpoch: 0,
      pageNumber: pageNum ?? null,
      viewport: null,
    };
  }

  private configurePageSurface(
    surface: PageSurface,
    width: number,
    height: number,
    viewport: PageViewport,
  ): void {
    surface.wrapper.style.width = `${width}px`;
    surface.wrapper.style.height = `${height}px`;
    surface.wrapper.style.setProperty('--total-scale-factor', `${viewport.scale}`);
    surface.wrapper.style.setProperty('--scale-round-x', '1px');
    surface.wrapper.style.setProperty('--scale-round-y', '1px');
    surface.textLayer.style.setProperty('--total-scale-factor', `${viewport.scale}`);
    surface.linkLayer.style.width = `${width}px`;
    surface.linkLayer.style.height = `${height}px`;
    surface.userAnnotationLayer.style.width = `${width}px`;
    surface.userAnnotationLayer.style.height = `${height}px`;
    surface.viewport = viewport;
  }

  private resetPageLayers(surface: PageSurface): number {
    surface.layerEpoch += 1;
    if (surface.textLayerTask) {
      surface.textLayerTask.cancel();
      surface.textLayerTask = null;
    }
    surface.textLayer.replaceChildren();
    surface.linkLayer.replaceChildren();
    surface.userAnnotationLayer.replaceChildren();
    return surface.layerEpoch;
  }

  private disposePageSurface(surface: PageSurface | undefined | null): void {
    if (!surface) return;
    this.resetPageLayers(surface);
    if (surface.wrapper.parentNode) {
      surface.wrapper.parentNode.removeChild(surface.wrapper);
    }
  }

  async loadPDF(pdfData: Uint8Array, fileName: string, filePath: string): Promise<void> {
    let passwordCancelled = false;
    let passwordRequestError: unknown = null;
    try {
      // Cancel any pending render
      if (this.renderTask) {
        this.renderTask.cancel();
      }

      // Lazy-load the PDF engine on first document open
      const pdfjsLib = await getPdfEngine();

      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      const passwordRequester = this.requestPassword;
      if (passwordRequester) {
        loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
          const requestReason =
            reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required';
          void passwordRequester(fileName, requestReason)
            .then(async (password) => {
              if (password === null) {
                passwordCancelled = true;
                await loadingTask.destroy();
                return;
              }
              updatePassword(password);
            })
            .catch(async (error) => {
              passwordRequestError = error;
              try {
                await loadingTask.destroy();
              } catch {
                // The original password UI error is the useful failure to report.
              }
            });
        };
      }
      this.pdfDoc = await loadingTask.promise;

      // Update state
      this.state.totalPages = this.pdfDoc.numPages;
      this.state.currentPage = 1;
      this.state.fileName = fileName;
      this.state.filePath = filePath;

      // Render page one immediately. Other dimensions are cached lazily as pages are requested.
      this.baseDimensions.clear();
      this.pageTextCache.clear();
      this.clearSearch();
      await this.renderPage(1);

      console.log(`Loaded PDF: ${fileName} (${this.state.totalPages} pages)`);
    } catch (error) {
      console.error('Error loading PDF:', error);
      if (passwordCancelled) {
        throw new Error('Password entry cancelled');
      }
      if (passwordRequestError) {
        throw new Error(
          `Password prompt failed: ${
            passwordRequestError instanceof Error
              ? passwordRequestError.message
              : String(passwordRequestError)
          }`,
        );
      }
      throw new Error(
        `Failed to load PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async renderInteractiveLayers(
    page: PDFPageProxy,
    viewport: PageViewport,
    surface: PageSurface,
  ): Promise<void> {
    const layerEpoch = this.resetPageLayers(surface);
    await Promise.all([
      this.renderTextLayer(page, viewport, surface, layerEpoch),
      this.renderLinkLayer(page, viewport, surface, layerEpoch),
    ]);
    if (surface.layerEpoch === layerEpoch) {
      this.renderUserAnnotations(surface, viewport);
    }
  }

  private async renderTextLayer(
    page: PDFPageProxy,
    viewport: PageViewport,
    surface: PageSurface,
    layerEpoch: number,
  ): Promise<void> {
    try {
      const textContent = await page.getTextContent();
      if (surface.layerEpoch !== layerEpoch) {
        return;
      }

      const pdfjsLib = await getPdfEngine();
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: surface.textLayer,
        viewport,
      });
      surface.textLayerTask = textLayer;
      await textLayer.render();
      if (surface.layerEpoch !== layerEpoch) {
        textLayer.cancel();
        return;
      }

      if (surface.textLayerTask === textLayer) {
        surface.textLayerTask = null;
      }
      this.applySearchHighlights(surface);
    } catch (error) {
      if (!isAbortLikeError(error)) {
        console.error('Error rendering text layer:', error);
      }
    }
  }

  private async renderLinkLayer(
    page: PDFPageProxy,
    viewport: PageViewport,
    surface: PageSurface,
    layerEpoch: number,
  ): Promise<void> {
    try {
      const annotations = (await page.getAnnotations({
        intent: 'display',
      })) as LinkAnnotationData[];
      if (surface.layerEpoch !== layerEpoch) {
        return;
      }

      const pdfjsLib = await getPdfEngine();

      for (const annotation of annotations) {
        if (surface.layerEpoch !== layerEpoch) {
          return;
        }

        if (annotation.annotationType !== pdfjsLib.AnnotationType.LINK || !annotation.rect) {
          continue;
        }

        const target = this.getLinkTarget(annotation);
        if (!target) {
          continue;
        }

        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect);
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.max(Math.abs(x2 - x1), 1);
        const height = Math.max(Math.abs(y2 - y1), 1);

        const section = document.createElement('section');
        section.className = 'linkAnnotation pdf-link-annotation';
        section.style.left = `${left}px`;
        section.style.top = `${top}px`;
        section.style.width = `${width}px`;
        section.style.height = `${height}px`;

        const linkAttributes = buildPdfLinkDomAttributes(target);
        const link = document.createElement('a');
        link.href = linkAttributes.href;
        link.title = linkAttributes.title;
        link.setAttribute('aria-label', linkAttributes.ariaLabel);
        link.dataset.pdfLink = 'true';
        this.linkTargets.set(link, target);

        const activate = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          void this.activateLinkTarget(target);
        };
        link.addEventListener('click', activate);
        link.addEventListener('auxclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (event.button === 1) {
            void this.activateLinkTarget(target);
          }
        });
        link.addEventListener('dragstart', (event) => {
          event.preventDefault();
        });

        section.appendChild(link);
        surface.linkLayer.appendChild(section);
      }
    } catch (error) {
      console.error('Error rendering link layer:', error);
    }
  }

  private getLinkTarget(annotation: LinkAnnotationData): PdfLinkTarget | null {
    const url =
      typeof annotation.url === 'string'
        ? annotation.url
        : typeof annotation.unsafeUrl === 'string'
          ? annotation.unsafeUrl
          : undefined;

    if (url) {
      return { url };
    }

    if (annotation.dest) {
      return { dest: annotation.dest };
    }

    return null;
  }

  private async activateLinkTarget(target: PdfLinkTarget): Promise<void> {
    this.hideContextMenu();

    if (target.url) {
      try {
        await invoke('open_external_url', { url: target.url });
      } catch (error) {
        console.error('Failed to open external link:', error);
        alert(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (target.dest) {
      const pageNum = await this.resolveDestinationPage(target.dest);
      if (pageNum !== null) {
        await this.goToPage(pageNum);
      }
    }
  }

  private async resolveDestinationPage(dest: PdfDestination): Promise<number | null> {
    if (!this.pdfDoc) return null;

    const explicitDest = Array.isArray(dest) ? dest : await this.pdfDoc.getDestination(dest);
    if (!explicitDest || explicitDest.length === 0) {
      return null;
    }

    const pageRef = explicitDest[0];
    if (typeof pageRef === 'number') {
      return Math.max(1, Math.min(pageRef + 1, this.state.totalPages));
    }

    if (
      pageRef &&
      typeof pageRef === 'object' &&
      'num' in pageRef &&
      'gen' in pageRef &&
      typeof (pageRef as { num?: unknown }).num === 'number' &&
      typeof (pageRef as { gen?: unknown }).gen === 'number'
    ) {
      const pageIndex = await this.pdfDoc.getPageIndex(pageRef as { num: number; gen: number });
      return Math.max(1, Math.min(pageIndex + 1, this.state.totalPages));
    }

    return null;
  }

  private handlePageContextMenu(event: MouseEvent): void {
    const target = event.target;
    const linkElement =
      target instanceof Element ? target.closest<HTMLElement>('[data-pdf-link="true"]') : null;
    const linkTarget = linkElement ? this.linkTargets.get(linkElement) : undefined;
    this.pendingSelectionHighlights = this.captureSelectionHighlights();
    const selectedText = this.pendingSelectionHighlights
      .map((selection) => selection.text)
      .join(' ');

    if (!linkTarget && !selectedText) {
      this.hideContextMenu();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.showContextMenu(event.clientX, event.clientY, linkTarget, selectedText);
  }

  private showContextMenu(
    clientX: number,
    clientY: number,
    linkTarget: PdfLinkTarget | undefined,
    selectedText: string,
  ): void {
    const menu = this.getContextMenu();
    menu.replaceChildren();

    if (linkTarget) {
      menu.append(
        this.createContextMenuButton('Open Link', () => {
          void this.activateLinkTarget(linkTarget);
        }),
        this.createContextMenuButton('Copy Link', () => {
          void this.copyLinkTarget(linkTarget);
        }),
      );
    }

    if (linkTarget && selectedText) {
      const separator = document.createElement('div');
      separator.className = 'pdf-context-menu-separator';
      menu.appendChild(separator);
    }

    if (selectedText) {
      menu.append(
        this.createContextMenuButton('Copy Text', () => {
          void this.copyText(selectedText);
        }),
        this.createContextMenuButton('Highlight Selection', () => {
          this.addPendingSelectionHighlights('');
        }),
      );

      const noteRequester = this.requestAnnotationNote;
      if (noteRequester) {
        menu.appendChild(
          this.createContextMenuButton('Highlight with Note…', () => {
            void noteRequester().then((note) => {
              if (note !== null) this.addPendingSelectionHighlights(note);
            });
          }),
        );
      }
    }

    menu.style.display = 'block';
    menu.style.left = '0px';
    menu.style.top = '0px';

    const { innerWidth, innerHeight } = window;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(clientX, innerWidth - rect.width - 8);
    const top = Math.min(clientY, innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }

  private createContextMenuButton(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hideContextMenu();
      action();
    });
    return button;
  }

  private getContextMenu(): HTMLDivElement {
    if (!this.contextMenu) {
      this.contextMenu = document.createElement('div');
      this.contextMenu.className = 'pdf-context-menu';
      this.contextMenu.style.display = 'none';
      document.body.appendChild(this.contextMenu);
    }
    return this.contextMenu;
  }

  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.style.display = 'none';
    }
  }

  private handleDocumentPointerDown(event: PointerEvent): void {
    this.isPointerDown = true;
    if (!this.contextMenu || this.contextMenu.style.display === 'none') return;
    if (event.target instanceof Node && this.contextMenu.contains(event.target)) return;
    this.hideContextMenu();
  }

  private handleDocumentPointerUp(): void {
    this.isPointerDown = false;
    this.clearSelectingTextLayers();
  }

  private handleDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.hideContextMenu();
    }
  }

  private handleSelectionChange(): void {
    if (!this.isPointerDown) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.clearSelectingTextLayers();
      return;
    }

    const activeTextLayers = new Set<HTMLDivElement>();
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const surface of this.getPageSurfaces()) {
        if (range.intersectsNode(surface.textLayer)) {
          activeTextLayers.add(surface.textLayer);
        }
      }
    }

    for (const surface of this.getPageSurfaces()) {
      surface.textLayer.classList.toggle('selecting', activeTextLayers.has(surface.textLayer));
    }
  }

  private clearSelectingTextLayers(): void {
    for (const surface of this.getPageSurfaces()) {
      surface.textLayer.classList.remove('selecting');
    }
  }

  private getPageSurfaces(): PageSurface[] {
    const surfaces = Array.from(this.pageSurfaces.values());
    if (this.singlePageSurface) {
      surfaces.push(this.singlePageSurface);
    }
    if (this.spreadPageSurface) {
      surfaces.push(this.spreadPageSurface);
    }
    return surfaces;
  }

  private captureSelectionHighlights(): SelectionHighlightData[] {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return [];
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) return [];

    const highlights: SelectionHighlightData[] = [];
    for (const surface of this.getPageSurfaces()) {
      if (!surface.viewport || surface.pageNumber === null) continue;

      const wrapperRect = surface.wrapper.getBoundingClientRect();
      const pdfRects: PdfAnnotationRect[] = [];

      for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex++) {
        const range = selection.getRangeAt(rangeIndex);
        if (!range.intersectsNode(surface.textLayer)) continue;

        for (const clientRect of Array.from(range.getClientRects())) {
          const left = Math.max(clientRect.left, wrapperRect.left);
          const top = Math.max(clientRect.top, wrapperRect.top);
          const right = Math.min(clientRect.right, wrapperRect.right);
          const bottom = Math.min(clientRect.bottom, wrapperRect.bottom);
          if (right <= left || bottom <= top) continue;

          const [pdfX1, pdfY1] = surface.viewport.convertToPdfPoint(
            left - wrapperRect.left,
            top - wrapperRect.top,
          );
          const [pdfX2, pdfY2] = surface.viewport.convertToPdfPoint(
            right - wrapperRect.left,
            bottom - wrapperRect.top,
          );
          pdfRects.push({
            x1: Math.min(pdfX1, pdfX2),
            y1: Math.min(pdfY1, pdfY2),
            x2: Math.max(pdfX1, pdfX2),
            y2: Math.max(pdfY1, pdfY2),
          });
        }
      }

      if (pdfRects.length > 0) {
        highlights.push({
          pageNumber: surface.pageNumber,
          rects: pdfRects,
          text: selectedText,
        });
      }
    }

    return highlights;
  }

  private addPendingSelectionHighlights(note: string): void {
    const timestamp = Date.now();
    const additions = this.pendingSelectionHighlights.map<PdfAnnotation>((selection) => ({
      id: crypto.randomUUID(),
      kind: 'highlight',
      pageNumber: selection.pageNumber,
      rects: selection.rects,
      text: selection.text,
      note,
      color: 'yellow',
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    this.pendingSelectionHighlights = [];
    if (additions.length === 0) return;

    this.annotations = [...this.annotations, ...additions];
    this.refreshUserAnnotationLayers();
    this.notifyAnnotationsChanged();
    window.getSelection()?.removeAllRanges();
  }

  private renderUserAnnotations(surface: PageSurface, viewport: PageViewport): void {
    surface.userAnnotationLayer.replaceChildren();
    if (surface.pageNumber === null) return;

    for (const annotation of this.annotations) {
      if (annotation.pageNumber !== surface.pageNumber) continue;

      annotation.rects.forEach((rect, rectIndex) => {
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
          rect.x1,
          rect.y1,
          rect.x2,
          rect.y2,
        ]);
        const highlight = document.createElement('button');
        highlight.type = 'button';
        highlight.className = `user-annotation user-annotation-${annotation.kind}`;
        highlight.dataset.annotationColor = annotation.color;
        highlight.dataset.annotationId = annotation.id;
        highlight.style.left = `${Math.min(x1, x2)}px`;
        highlight.style.top = `${Math.min(y1, y2)}px`;
        highlight.style.width = `${Math.max(Math.abs(x2 - x1), 4)}px`;
        highlight.style.height = `${Math.max(Math.abs(y2 - y1), 4)}px`;
        highlight.title =
          annotation.note || annotation.text || `Annotation on page ${annotation.pageNumber}`;
        highlight.setAttribute('aria-label', highlight.title);

        if (rectIndex === 0 && annotation.note) {
          highlight.classList.add('has-note');
        }
        highlight.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.onAnnotationsChange?.(this.getAnnotations());
        });
        surface.userAnnotationLayer.appendChild(highlight);
      });
    }
  }

  private refreshUserAnnotationLayers(): void {
    for (const surface of this.getPageSurfaces()) {
      if (surface.viewport) this.renderUserAnnotations(surface, surface.viewport);
    }
  }

  private notifyAnnotationsChanged(): void {
    this.onAnnotationsChange?.(this.getAnnotations());
  }

  setAnnotations(annotations: readonly PdfAnnotation[]): void {
    this.annotations = annotations.map((annotation) => ({
      ...annotation,
      rects: annotation.rects.map((rect) => ({ ...rect })),
    }));
    this.refreshUserAnnotationLayers();
  }

  getAnnotations(): PdfAnnotation[] {
    return this.annotations.map((annotation) => ({
      ...annotation,
      rects: annotation.rects.map((rect) => ({ ...rect })),
    }));
  }

  async addPageNote(note: string): Promise<void> {
    const surface = this.getSurfaceForPage(this.state.currentPage);
    const viewport = surface?.viewport;
    if (!viewport || !note.trim()) return;

    const [pdfX1, pdfY1] = viewport.convertToPdfPoint(viewport.width - 32, 20);
    const [pdfX2, pdfY2] = viewport.convertToPdfPoint(viewport.width - 12, 40);
    const timestamp = Date.now();
    this.annotations = [
      ...this.annotations,
      {
        id: crypto.randomUUID(),
        kind: 'note',
        pageNumber: this.state.currentPage,
        rects: [
          {
            x1: Math.min(pdfX1, pdfX2),
            y1: Math.min(pdfY1, pdfY2),
            x2: Math.max(pdfX1, pdfX2),
            y2: Math.max(pdfY1, pdfY2),
          },
        ],
        text: '',
        note: note.trim(),
        color: 'yellow',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    this.refreshUserAnnotationLayers();
    this.notifyAnnotationsChanged();
  }

  updateAnnotation(
    annotationId: string,
    updates: { note?: string; color?: PdfAnnotationColor },
  ): void {
    let changed = false;
    this.annotations = this.annotations.map((annotation) => {
      if (annotation.id !== annotationId) return annotation;
      changed = true;
      return { ...annotation, ...updates, updatedAt: Date.now() };
    });
    if (!changed) return;
    this.refreshUserAnnotationLayers();
    this.notifyAnnotationsChanged();
  }

  removeAnnotation(annotationId: string): void {
    const next = this.annotations.filter((annotation) => annotation.id !== annotationId);
    if (next.length === this.annotations.length) return;
    this.annotations = next;
    this.refreshUserAnnotationLayers();
    this.notifyAnnotationsChanged();
  }

  private getSurfaceForPage(pageNumber: number): PageSurface | null {
    if (this.singlePageSurface?.pageNumber === pageNumber) return this.singlePageSurface;
    if (this.spreadPageSurface?.pageNumber === pageNumber) return this.spreadPageSurface;
    return this.pageSurfaces.get(pageNumber) ?? null;
  }

  private async copyLinkTarget(target: PdfLinkTarget): Promise<void> {
    if (target.url) {
      await this.copyText(target.url);
      return;
    }

    if (target.dest) {
      const pageNum = await this.resolveDestinationPage(target.dest);
      await this.copyText(pageNum ? `#page=${pageNum}` : this.describeDestination(target.dest));
    }
  }

  private describeDestination(dest: PdfDestination): string {
    return typeof dest === 'string' ? `#${dest}` : JSON.stringify(dest);
  }

  private async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.setAttribute('readonly', 'true');
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  }

  private async getPageText(pageNumber: number): Promise<string> {
    const cached = this.pageTextCache.get(pageNumber);
    if (cached !== undefined) return cached;
    if (!this.pdfDoc) return '';

    const page = await this.pdfDoc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    this.pageTextCache.set(pageNumber, text);
    return text;
  }

  async searchText(query: string): Promise<PdfSearchMatch[]> {
    const normalizedQuery = query.trim();
    this.searchQuery = normalizedQuery;
    this.searchMatches = [];
    this.activeSearchMatch = null;
    this.refreshSearchHighlights();
    if (!normalizedQuery || !this.pdfDoc) return [];

    const matches: PdfSearchMatch[] = [];
    for (let pageNumber = 1; pageNumber <= this.state.totalPages; pageNumber++) {
      if (this.searchQuery !== normalizedQuery) return [];
      const pageText = await this.getPageText(pageNumber);
      if (this.searchQuery !== normalizedQuery) return [];
      matches.push(...findPageTextMatches(pageText, normalizedQuery, pageNumber));
    }

    if (this.searchQuery !== normalizedQuery) return [];
    this.searchMatches = matches;
    return matches.map((match) => ({ ...match }));
  }

  async revealSearchMatch(match: PdfSearchMatch): Promise<void> {
    this.activeSearchMatch = { ...match };
    await this.goToPage(match.pageNumber);
    this.refreshSearchHighlights();

    window.requestAnimationFrame(() => {
      const activeMark = this.container.querySelector<HTMLElement>(
        '.pdf-search-hit[aria-current="true"]',
      );
      activeMark?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  }

  getSearchMatches(): PdfSearchMatch[] {
    return this.searchMatches.map((match) => ({ ...match }));
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchMatches = [];
    this.activeSearchMatch = null;
    this.refreshSearchHighlights();
  }

  private refreshSearchHighlights(): void {
    for (const surface of this.getPageSurfaces()) {
      this.applySearchHighlights(surface);
    }
  }

  private applySearchHighlights(surface: PageSurface): void {
    const textSpans = Array.from(surface.textLayer.querySelectorAll<HTMLElement>('span'));
    for (const span of textSpans) {
      const originalText = span.dataset.searchOriginalText;
      if (originalText !== undefined) {
        span.replaceChildren(originalText);
        delete span.dataset.searchOriginalText;
      }
    }

    const query = this.searchQuery.toLocaleLowerCase();
    if (!query || surface.pageNumber === null) return;

    let pageOccurrence = 0;
    for (const span of textSpans) {
      const originalText = span.textContent ?? '';
      const normalizedText = originalText.toLocaleLowerCase();
      if (!normalizedText.includes(query)) continue;

      span.dataset.searchOriginalText = originalText;
      span.replaceChildren();
      let cursor = 0;

      while (cursor <= normalizedText.length - query.length) {
        const index = normalizedText.indexOf(query, cursor);
        if (index === -1) break;
        if (index > cursor) span.append(originalText.slice(cursor, index));

        const mark = document.createElement('mark');
        mark.className = 'pdf-search-hit';
        mark.textContent = originalText.slice(index, index + query.length);
        const isActive =
          this.activeSearchMatch?.pageNumber === surface.pageNumber &&
          this.activeSearchMatch.pageOccurrence === pageOccurrence;
        if (isActive) {
          mark.classList.add('pdf-search-hit-active');
          mark.setAttribute('aria-current', 'true');
        }
        span.appendChild(mark);
        pageOccurrence += 1;
        cursor = index + query.length;
      }

      if (cursor < originalText.length) span.append(originalText.slice(cursor));
    }
  }

  async getOutlineItems(): Promise<PdfOutlineItem[]> {
    if (!this.pdfDoc) return [];
    const outline = (await this.pdfDoc.getOutline()) as unknown as RawOutlineItem[];

    const resolveItems = async (items: RawOutlineItem[]): Promise<PdfOutlineItem[]> =>
      Promise.all(
        items.map(async (item) => ({
          title: item.title || 'Untitled section',
          pageNumber: item.dest ? await this.resolveDestinationPage(item.dest) : null,
          url: item.url ?? item.unsafeUrl,
          bold: item.bold,
          italic: item.italic,
          items: await resolveItems(item.items ?? []),
        })),
      );

    return resolveItems(outline ?? []);
  }

  async activateOutlineItem(item: PdfOutlineItem): Promise<void> {
    if (item.pageNumber !== null) {
      await this.goToPage(item.pageNumber);
      return;
    }
    if (item.url) {
      await this.activateLinkTarget({ url: item.url });
    }
  }

  async renderThumbnail(
    pageNumber: number,
    options: { maxWidth?: number; rotation?: number } = {},
  ): Promise<HTMLCanvasElement> {
    if (!this.pdfDoc) throw new Error('PDF not loaded');
    const { maxWidth = 144, rotation = this.state.rotation } = options;
    const page = await this.pdfDoc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1, rotation });
    const scale = Math.min(maxWidth / baseViewport.width, 1);
    const viewport = page.getViewport({ scale, rotation });
    const canvas = document.createElement('canvas');
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    canvas.style.filter = this.currentFilterCSS;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not render page thumbnail');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const task = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    } as unknown as Parameters<PDFPageProxy['render']>[0]);
    await task.promise;
    return canvas;
  }

  async renderPage(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.canvas || !this.singlePageSurface) {
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
      this.cacheBaseDimensions(pageNum, page);

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

      const outputScale = getOutputScale(viewport.width, viewport.height);
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
      this.singlePageSurface.pageNumber = pageNum;
      this.configurePageSurface(this.singlePageSurface, pageWidth, pageHeight, viewport);
      const targetContext = this.canvas.getContext('2d', { alpha: false });
      targetContext?.drawImage(renderCanvas, 0, 0);
      await this.renderInteractiveLayers(page, viewport, this.singlePageSurface);

      // Update state
      const prevPage = this.state.currentPage;
      this.state.currentPage = pageNum;
      if (prevPage !== pageNum) {
        this.onPageChange?.(pageNum);
      }

      if (this.state.viewMode === 'spread') {
        await this.renderSpreadCompanion(pageNum + 1);
      } else if (this.spreadPageSurface) {
        this.spreadPageSurface.wrapper.style.display = 'none';
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

  private ensureSpreadSurface(): PageSurface {
    if (!this.spreadPageSurface) {
      this.spreadPageSurface = this.createPageSurface(`${this.canvasId}-spread`);
      this.spreadPageSurface.wrapper.classList.add('spread-secondary');
      this.container.appendChild(this.spreadPageSurface.wrapper);
    }
    return this.spreadPageSurface;
  }

  private async renderSpreadCompanion(pageNumber: number): Promise<void> {
    if (!this.pdfDoc) return;
    const surface = this.ensureSpreadSurface();
    if (pageNumber > this.state.totalPages) {
      surface.pageNumber = null;
      surface.wrapper.style.display = 'none';
      return;
    }

    if (this.spreadRenderTask) {
      this.spreadRenderTask.cancel();
      this.spreadRenderTask = null;
    }

    try {
      const page = await this.pdfDoc.getPage(pageNumber);
      this.cacheBaseDimensions(pageNumber, page);
      const viewport = page.getViewport({
        scale: this.state.zoom,
        rotation: this.state.rotation,
      });
      const context = surface.canvas.getContext('2d', { alpha: false });
      if (!context) return;

      const outputScale = getOutputScale(viewport.width, viewport.height);
      const sfx = approximateFraction(outputScale.sx);
      const sfy = approximateFraction(outputScale.sy);
      const canvasWidth = floorToDivide(calcRound(viewport.width * outputScale.sx), sfx[0]);
      const canvasHeight = floorToDivide(calcRound(viewport.height * outputScale.sy), sfy[0]);
      const pageWidth = floorToDivide(calcRound(viewport.width), sfx[1]);
      const pageHeight = floorToDivide(calcRound(viewport.height), sfy[1]);

      surface.canvas.width = canvasWidth;
      surface.canvas.height = canvasHeight;
      surface.canvas.style.width = `${pageWidth}px`;
      surface.canvas.style.height = `${pageHeight}px`;
      surface.canvas.style.filter = this.currentFilterCSS;
      surface.pageNumber = pageNumber;
      this.configurePageSurface(surface, pageWidth, pageHeight, viewport);
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
      this.spreadRenderTask = renderTask;
      await renderTask.promise;
      if (this.spreadRenderTask !== renderTask) return;
      this.spreadRenderTask = null;
      await this.renderInteractiveLayers(page, viewport, surface);
      surface.wrapper.style.display = this.isVisible ? 'block' : 'none';
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'RenderingCancelledException'
      ) {
        return;
      }
      throw error;
    }
  }

  async nextPage(): Promise<void> {
    const step = this.state.viewMode === 'spread' ? 2 : 1;
    if (this.state.currentPage < this.state.totalPages) {
      await this.goToPage(Math.min(this.state.currentPage + step, this.state.totalPages));
    }
  }

  async previousPage(): Promise<void> {
    const step = this.state.viewMode === 'spread' ? 2 : 1;
    if (this.state.currentPage > 1) {
      await this.goToPage(Math.max(this.state.currentPage - step, 1));
    }
  }

  async goToPage(pageNum: number): Promise<void> {
    if (this.onPageNavigationRequest) {
      await this.onPageNavigationRequest(pageNum);
      return;
    }
    await this.projectPage(pageNum);
  }

  private async projectPage(pageNum: number): Promise<void> {
    if (this.state.viewMode === 'continuous') {
      await this.scrollToPage(pageNum);
      return;
    }

    await this.renderPage(pageNum);
  }

  async firstPage(): Promise<void> {
    await this.goToPage(1);
  }

  async lastPage(): Promise<void> {
    if (this.pdfDoc) {
      await this.goToPage(this.state.totalPages);
    }
  }

  async rotateClockwise(): Promise<void> {
    await this.setRotation(this.state.rotation + 90);
  }

  async rotateCounterClockwise(): Promise<void> {
    await this.setRotation(this.state.rotation - 90);
  }

  async setRotation(rotation: number): Promise<void> {
    const finiteRotation = Number.isFinite(rotation) ? rotation : 0;
    const normalized = (((Math.round(finiteRotation / 90) * 90) % 360) + 360) % 360;
    if (this.state.rotation === normalized) return;

    const currentPage = this.state.currentPage;
    this.state.rotation = normalized;
    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
      await this.scrollToPage(currentPage);
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

  private handleWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.pendingWheelDelta += event.deltaY;
    if (this.wheelZoomRafId !== null) return;

    const clientX = event.clientX;
    const clientY = event.clientY;
    this.wheelZoomRafId = window.requestAnimationFrame(() => {
      this.wheelZoomRafId = null;
      const delta = this.pendingWheelDelta;
      this.pendingWheelDelta = 0;
      const targetZoom = this.state.zoom * Math.exp(-delta * 0.002);
      void this.zoomAtPoint(targetZoom, clientX, clientY);
    });
  }

  private handleGestureStart(event: Event): void {
    event.preventDefault();
    this.pinchStartZoom = this.state.zoom;
  }

  private handleGestureChange(event: Event): void {
    const gesture = event as GestureLikeEvent;
    if (!gesture.scale || !Number.isFinite(gesture.scale)) return;
    event.preventDefault();
    const rect = this.container.getBoundingClientRect();
    void this.zoomAtPoint(
      this.pinchStartZoom * gesture.scale,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  }

  private async zoomAtPoint(targetZoom: number, clientX: number, clientY: number): Promise<void> {
    const epoch = ++this.pinchRenderEpoch;
    const oldZoom = this.state.zoom;
    const rect = this.container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const documentX = (this.container.scrollLeft + localX) / oldZoom;
    const documentY = (this.container.scrollTop + localY) / oldZoom;

    await this.setZoom(targetZoom);
    if (epoch !== this.pinchRenderEpoch) return;

    const scale = this.state.zoom;
    this.container.scrollLeft = Math.max(0, documentX * scale - localX);
    this.container.scrollTop = Math.max(0, documentY * scale - localY);
    this.onScrollChange?.(this.container.scrollTop);
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

    const currentPage = this.state.currentPage;
    const base = this.baseDimensions.get(currentPage);
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
      const page = await this.pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.0, rotation: this.state.rotation });
      baseWidth = viewport.width;
    }
    const containerWidth =
      this.state.viewMode === 'spread'
        ? (this.container.clientWidth - 52) / 2
        : this.container.clientWidth - 40;

    this.state.zoom = containerWidth / baseWidth;

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
      await this.scrollToPage(currentPage);
    } else {
      await this.renderPage(currentPage);
    }
  }

  async fitToPage(): Promise<void> {
    if (!this.pdfDoc || !this.canvas) return;

    const currentPage = this.state.currentPage;
    const base = this.baseDimensions.get(currentPage);
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
      const page = await this.pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.0, rotation: this.state.rotation });
      baseWidth = viewport.width;
      baseHeight = viewport.height;
    }
    const containerWidth =
      this.state.viewMode === 'spread'
        ? (this.container.clientWidth - 52) / 2
        : this.container.clientWidth - 40;
    const containerHeight = this.container.clientHeight - 40;

    const widthScale = containerWidth / baseWidth;
    const heightScale = containerHeight / baseHeight;

    this.state.zoom = Math.min(widthScale, heightScale);

    if (this.state.viewMode === 'continuous') {
      await this.calculateAllPageDimensions();
      await this.renderVisiblePages(true);
      await this.scrollToPage(currentPage);
    } else {
      await this.renderPage(currentPage);
    }
  }

  applyFilter(filterCSS: string): void {
    this.currentFilterCSS = filterCSS;

    if (this.canvas) {
      this.canvas.style.filter = filterCSS;
    }
    if (this.spreadPageSurface) {
      this.spreadPageSurface.canvas.style.filter = filterCSS;
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

  getScrollPosition(): number {
    return this.container.scrollTop;
  }

  getReadingPosition(): ReadingPosition {
    if (this.state.viewMode !== 'continuous' || this.offsetArray.length === 0) {
      return { page: this.state.currentPage, location: 0 };
    }
    const pageHeights = Array.from(
      { length: this.state.totalPages },
      (_, index) => this.pageHeights.get(index + 1) ?? 0,
    );
    return captureReadingPosition({
      pageOffsets: this.offsetArray,
      pageHeights,
      scrollTop: this.container.scrollTop,
      pagePadding: this.pagePadding,
    });
  }

  async goToReadingPosition(position: RestorableReadingPosition): Promise<void> {
    await this.projectPage(position.page);
    if (this.state.viewMode !== 'continuous' || this.offsetArray.length === 0) return;
    const pageHeights = Array.from(
      { length: this.state.totalPages },
      (_, index) => this.pageHeights.get(index + 1) ?? 0,
    );
    this.container.scrollTop = restoreReadingPosition(position, {
      pageOffsets: this.offsetArray,
      pageHeights,
      pagePadding: this.pagePadding,
    });
    await this.renderVisiblePages();
  }

  async setScrollPosition(scrollPosition: number): Promise<void> {
    const normalized = Number.isFinite(scrollPosition) ? Math.max(scrollPosition, 0) : 0;
    this.container.scrollTop = normalized;

    if (this.state.viewMode === 'continuous') {
      await this.renderVisiblePages();
    }
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
    this.isVisible = visible;
    if (!visible) {
      this.hideContextMenu();
    }

    if (visible && !this.isScrollListenerAttached) {
      this.container.addEventListener('scroll', this.handleScrollBound);
      this.container.addEventListener('wheel', this.handleWheelBound, { passive: false });
      this.container.addEventListener('gesturestart', this.handleGestureStartBound);
      this.container.addEventListener('gesturechange', this.handleGestureChangeBound);
      this.isScrollListenerAttached = true;
    } else if (!visible && this.isScrollListenerAttached) {
      this.container.removeEventListener('scroll', this.handleScrollBound);
      this.container.removeEventListener('wheel', this.handleWheelBound);
      this.container.removeEventListener('gesturestart', this.handleGestureStartBound);
      this.container.removeEventListener('gesturechange', this.handleGestureChangeBound);
      this.isScrollListenerAttached = false;
      if (this.scrollRafId !== null) {
        window.cancelAnimationFrame(this.scrollRafId);
        this.scrollRafId = null;
      }
      if (this.wheelZoomRafId !== null) {
        window.cancelAnimationFrame(this.wheelZoomRafId);
        this.wheelZoomRafId = null;
      }
      this.pendingWheelDelta = 0;
    }

    if (visible) this.applyViewModeClasses();

    if (this.state.viewMode === 'continuous') {
      // In continuous mode, show/hide the scroll wrapper
      if (this.scrollContainer) {
        this.scrollContainer.style.display = visible ? 'block' : 'none';
      }
      // Keep single-page canvas hidden
      if (this.singlePageSurface) {
        this.singlePageSurface.wrapper.style.display = 'none';
      }
      if (this.spreadPageSurface) {
        this.spreadPageSurface.wrapper.style.display = 'none';
      }
    } else {
      // In single-page mode, show/hide the main canvas
      if (this.singlePageSurface) {
        this.singlePageSurface.wrapper.style.display = visible ? 'block' : 'none';
      }
      if (this.spreadPageSurface) {
        const showCompanion =
          visible && this.state.viewMode === 'spread' && this.spreadPageSurface.pageNumber !== null;
        this.spreadPageSurface.wrapper.style.display = showCompanion ? 'block' : 'none';
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

  async setViewMode(mode: ViewMode): Promise<void> {
    if (this.state.viewMode === mode) return;

    const currentPage = this.state.currentPage;
    const previousMode = this.state.viewMode;
    if (previousMode === 'continuous') {
      this.cleanupContinuousScroll();
    }
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
      this.applyViewModeClasses();
      await this.renderPage(currentPage);
      this.setVisible(true);
    }
  }

  private applyViewModeClasses(): void {
    if (!this.isVisible) return;
    this.container.classList.toggle('continuous-scroll', this.state.viewMode === 'continuous');
    this.container.classList.toggle('spread-view', this.state.viewMode === 'spread');
  }

  private async initializeContinuousScroll(): Promise<void> {
    if (!this.pdfDoc) return;

    // Create scroll container if it doesn't exist
    if (!this.scrollContainer) {
      this.scrollContainer = document.createElement('div');
      this.scrollContainer.className = 'scroll-wrapper';
      this.container.appendChild(this.scrollContainer);
    }

    // Keep the already-rendered first page visible while the continuous layout is measured.
    await this.calculateAllPageDimensions();

    if (this.singlePageSurface) {
      this.singlePageSurface.wrapper.style.display = 'none';
    }
    this.container.classList.add('continuous-scroll');
  }

  private cleanupContinuousScroll(): void {
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

    // Remove all continuous page surfaces
    this.pageSurfaces.forEach((surface) => {
      this.disposePageSurface(surface);
    });
    this.pageSurfaces.clear();
    this.canvases.clear();

    // Remove scroll container
    if (this.scrollContainer?.parentNode) {
      this.scrollContainer.parentNode.removeChild(this.scrollContainer);
      this.scrollContainer = null;
    }

    // Remove continuous-scroll class
    this.container.classList.remove('continuous-scroll');

    // Show single-page canvas
    if (this.singlePageSurface) {
      this.singlePageSurface.wrapper.style.display = 'block';
    }

    // Clear state
    this.visiblePages.clear();
    this.renderedPages.clear();
    this.pageHeights.clear();
    this.pageWidths.clear();
    this.offsetArray = [];
  }

  private cacheBaseDimensions(
    pageNum: number,
    page: PDFPageProxy,
  ): {
    width: number;
    height: number;
  } {
    const cached = this.baseDimensions.get(pageNum);
    if (cached) return cached;

    const viewport = page.getViewport({ scale: 1.0, rotation: 0 });
    const dimensions = { width: viewport.width, height: viewport.height };
    this.baseDimensions.set(pageNum, dimensions);
    return dimensions;
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
        // Lazily fetch and cache dimensions the first time a page needs layout.
        const page = await this.pdfDoc.getPage(pageNum);
        const dimensions = this.cacheBaseDimensions(pageNum, page);
        const scaled = deriveScaledDimensions({
          baseWidth: dimensions.width,
          baseHeight: dimensions.height,
          zoom: this.state.zoom,
          rotation: this.state.rotation,
        });
        this.pageWidths.set(pageNum, Math.floor(scaled.width));
        this.pageHeights.set(pageNum, Math.floor(scaled.height));
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

    this.pageSurfaces.forEach((surface, pageNum) => {
      if (pagesToKeep.has(pageNum)) return;

      this.disposePageSurface(surface);
      this.pageSurfaces.delete(pageNum);
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
      this.cacheBaseDimensions(pageNum, page);

      // Calculate viewport
      const viewport = page.getViewport({
        scale: this.state.zoom,
        rotation: this.state.rotation,
      });

      const surface = this.createPageSurface(`${this.canvasId}-page-${pageNum}`, pageNum);
      const { canvas } = surface;
      surface.wrapper.style.top = `${this.getPagePosition(pageNum)}px`;
      surface.wrapper.style.display = 'block';

      // Set canvas dimensions
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;

      const outputScale = getOutputScale(viewport.width, viewport.height);
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
      this.configurePageSurface(surface, pageWidth, pageHeight, viewport);

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
        this.disposePageSurface(surface);
        return;
      }

      this.renderTasks.delete(pageNum);

      if (!this.calculateVisiblePages(this.cleanupBufferPages).includes(pageNum)) {
        this.disposePageSurface(surface);
        return;
      }

      await this.renderInteractiveLayers(page, viewport, surface);

      const previousSurface = this.pageSurfaces.get(pageNum);
      if (previousSurface?.wrapper.parentNode) {
        previousSurface.wrapper.parentNode.replaceChild(surface.wrapper, previousSurface.wrapper);
        this.disposePageSurface(previousSurface);
      } else {
        this.insertSurfaceAtPosition(surface, pageNum);
      }

      this.canvases.set(pageNum, canvas);
      this.pageSurfaces.set(pageNum, surface);
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

  private insertSurfaceAtPosition(surface: PageSurface, pageNum: number): void {
    if (!this.scrollContainer) return;

    // Find the correct position to insert
    const existingSurfaces = Array.from(
      this.scrollContainer.querySelectorAll('.pdf-page-surface[data-page-num]'),
    ) as HTMLDivElement[];
    let inserted = false;

    for (let i = 0; i < existingSurfaces.length; i++) {
      const existingPageNum = Number.parseInt(existingSurfaces[i].dataset.pageNum || '0', 10);
      if (pageNum < existingPageNum) {
        this.scrollContainer.insertBefore(surface.wrapper, existingSurfaces[i]);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.scrollContainer.appendChild(surface.wrapper);
    }
  }

  private handleScroll(): void {
    if (this.scrollSettleTimer !== null) {
      window.clearTimeout(this.scrollSettleTimer);
    }
    this.scrollSettleTimer = window.setTimeout(() => {
      this.scrollSettleTimer = null;
      this.onScrollSettled?.();
    }, 150);

    // Throttle scroll events
    if (this.scrollRafId !== null) {
      return;
    }

    this.scrollRafId = window.requestAnimationFrame(() => {
      this.scrollRafId = null;
      this.onScrollChange?.(this.container.scrollTop);
      if (this.state.viewMode === 'continuous') {
        void this.renderVisiblePages();
      }
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
      await this.renderPage(pageNum);
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
    const surface = this.pageSurfaces.get(pageNum);
    if (!surface) return;
    surface.wrapper.style.top = `${this.getPagePosition(pageNum)}px`;
  }

  destroy(): void {
    if (this.scrollSettleTimer !== null) {
      window.clearTimeout(this.scrollSettleTimer);
      this.scrollSettleTimer = null;
    }
    document.removeEventListener('pointerdown', this.handleDocumentPointerDownBound, true);
    document.removeEventListener('pointerup', this.handleDocumentPointerUpBound, true);
    document.removeEventListener('keydown', this.handleDocumentKeyDownBound);
    document.removeEventListener('selectionchange', this.handleSelectionChangeBound);
    if (this.isScrollListenerAttached) {
      this.container.removeEventListener('scroll', this.handleScrollBound);
      this.container.removeEventListener('wheel', this.handleWheelBound);
      this.container.removeEventListener('gesturestart', this.handleGestureStartBound);
      this.container.removeEventListener('gesturechange', this.handleGestureChangeBound);
      this.isScrollListenerAttached = false;
    }
    if (this.wheelZoomRafId !== null) {
      window.cancelAnimationFrame(this.wheelZoomRafId);
      this.wheelZoomRafId = null;
    }
    this.pendingWheelDelta = 0;
    if (this.contextMenu?.parentNode) {
      this.contextMenu.parentNode.removeChild(this.contextMenu);
    }
    this.contextMenu = null;

    // Cleanup continuous scroll if active
    if (this.state.viewMode === 'continuous') {
      this.cleanupContinuousScroll();
    }

    if (this.renderTask) {
      this.renderTask.cancel();
    }
    if (this.spreadRenderTask) {
      this.spreadRenderTask.cancel();
    }
    this.disposePageSurface(this.singlePageSurface);
    this.disposePageSurface(this.spreadPageSurface);
    if (this.pdfDoc) {
      this.pdfDoc.destroy();
    }
    this.pdfDoc = null;
    this.canvas = null;
    this.singlePageSurface = null;
    this.spreadPageSurface = null;
  }
}
