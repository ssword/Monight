import { debugLog } from '../lib/debug-log';
import type { ViewMode } from '../lib/document-features';
import type { PdfLinkTarget } from '../lib/pdf-links';
import { type AnnotationAccess, createTransientAnnotationAccess } from '../reader/annotations';
import type {
  LoadableDocumentContent,
  ResolvedDocumentLinkTarget,
} from '../reader/document-content';
import type { DocumentRuntime } from '../reader/document-queries';
import type { DocumentRendering } from '../reader/document-rendering';
import { createPdfDocumentContent } from '../reader/pdf-document-content';
import type {
  ReaderActionOptions,
  ReadingPosition,
  ReadingSessionDocument,
  RestorableReadingPosition,
  ZoomIntent,
} from '../reader/reader-actions';
import { type FilterSettings, PRESETS } from './filters';
import { type AnnotationNoteRequester, PDFViewer, type PdfPasswordRequester } from './pdf-viewer';
import { applyProjectedDocumentStateToTab, projectTabStateToViewer } from './tab-reading-session';

/**
 * Data structure for a single tab
 */
export interface TabData {
  id: string; // Unique UUID
  title: string; // Filename for display
  filePath: string; // Full file path
  filterSettings: FilterSettings; // Current filter preset
  currentPage: number; // Current page number
  zoom: number; // Current zoom level
  zoomIntent: ZoomIntent; // Settled reader choice, independent of viewport
  rotation: number; // Clockwise page rotation in degrees
  scrollPosition: number; // Scroll position
  viewMode: ViewMode; // View mode
}

interface TabManagerOptions {
  annotationAuthority?: AnnotationAccess;
  onDocumentPrepared?: (tab: TabData, runtime: DocumentRuntime) => void | Promise<void>;
  onDocumentOpened?: (tab: TabData) => void | Promise<void>;
  onDocumentClosed?: (filePath: string) => void | Promise<void>;
  onDocumentCloseRequested?: (filePath: string) => void | Promise<void>;
  onReadingPositionObserved?: (filePath: string, position: ReadingPosition) => void;
  onReadingPositionSettled?: (filePath: string, position: ReadingPosition) => void;
  onPageNavigationRequested?: (page: number, options?: ReaderActionOptions) => Promise<void>;
  onDocumentPageRequested?: (filePath: string, page: number) => Promise<void>;
  onZoomIntentRequested?: (filePath: string, zoomIntent: ZoomIntent) => Promise<void>;
  requestPassword?: PdfPasswordRequester;
  requestAnnotationNote?: AnnotationNoteRequester;
  reportError?: (message: string) => void;
  createDocumentContent?: () => LoadableDocumentContent;
  resolveLinkTarget?: (
    filePath: string,
    target: PdfLinkTarget,
  ) => Promise<ResolvedDocumentLinkTarget | null>;
  onDocumentLinkTargetActivated?: (filePath: string, target: PdfLinkTarget) => Promise<void>;
}

interface CreateTabOptions {
  activate?: boolean;
  initialPage?: number;
  notifyOpened?: boolean;
  restoredDocument?: ReadingSessionDocument;
}

interface ReactivateOpenDocumentOptions {
  notifyOpened?: boolean;
}

interface ActivateTabOptions {
  readingPosition?: RestorableReadingPosition;
}

/**
 * Manages multiple PDF tabs with individual state
 */
export class TabManager {
  private tabs: Map<string, TabData> = new Map();
  private activeTabId: string | null = null;
  private renderings: Map<string, DocumentRendering> = new Map();
  private onTabChange: (tab: TabData | null) => void | Promise<void>;
  private onActiveViewerStateChange?: () => void;
  private onTabsChanged?: () => void;
  private options: TabManagerOptions;
  private readonly annotationAuthority: AnnotationAccess;
  private requestActivation:
    | ((filePath: string, readingPosition?: RestorableReadingPosition) => Promise<void>)
    | null = null;

  constructor(
    onTabChange: (tab: TabData | null) => void | Promise<void>,
    onActiveViewerStateChange?: () => void,
    onTabsChanged?: () => void,
    options: TabManagerOptions = {},
  ) {
    this.onTabChange = onTabChange;
    this.onActiveViewerStateChange = onActiveViewerStateChange;
    this.onTabsChanged = onTabsChanged;
    this.options = options;
    this.annotationAuthority = options.annotationAuthority ?? createTransientAnnotationAccess();
  }

  /**
   * Create a new tab
   */
  async createTab(
    filePath: string,
    title: string,
    pdfData: Uint8Array,
    filterSettings?: FilterSettings,
    viewMode: ViewMode = 'single',
    { activate = true, initialPage, notifyOpened = true, restoredDocument }: CreateTabOptions = {},
  ): Promise<TabData> {
    const id = crypto.randomUUID();
    const previousActiveTabId = this.activeTabId;
    const initialFilterSettings = filterSettings ?? PRESETS.default;

    // Create tab data
    const tab: TabData = {
      id,
      title,
      filePath,
      filterSettings: { ...initialFilterSettings },
      currentPage: 1,
      zoom: 1.0,
      zoomIntent: { kind: 'manual', scale: 1 },
      rotation: 0,
      scrollPosition: 0,
      viewMode,
    };
    if (restoredDocument) {
      applyProjectedDocumentStateToTab(tab, restoredDocument);
    }

    // Store tab
    this.tabs.set(id, tab);

    const content =
      this.options.createDocumentContent?.() ??
      createPdfDocumentContent({ requestPassword: this.options.requestPassword });
    const resolveLinkTarget = this.options.resolveLinkTarget;

    // Create the rendering adapter for this Document.
    const canvasId = `pdf-canvas-${id}`;
    const viewer = new PDFViewer('pdf-container', canvasId, {
      content,
      requestAnnotationNote: this.options.requestAnnotationNote,
      reportError: this.options.reportError,
      ...(resolveLinkTarget
        ? {
            resolveLinkTarget: (target) => resolveLinkTarget(filePath, target),
          }
        : {}),
      ...(this.options.onDocumentLinkTargetActivated
        ? {
            activateLinkTarget: (target) =>
              this.options.onDocumentLinkTargetActivated?.(filePath, target) ?? Promise.resolve(),
          }
        : {}),
    });
    let runtimeDestroyed = false;
    const runtime: DocumentRuntime = {
      content,
      async destroy() {
        if (runtimeDestroyed) return;
        runtimeDestroyed = true;
        await content.destroy();
      },
      renderThumbnail: (pageNumber, options) => viewer.renderThumbnail(pageNumber, options),
      getAnnotations: () => this.annotationAuthority.snapshot(filePath),
    };
    viewer.setOnPageChange(() => {
      if (this.activeTabId !== id) return;
      this.onActiveViewerStateChange?.();
    });
    viewer.setOnScrollChange(() => {
      if (this.activeTabId !== id) return;
      tab.scrollPosition = viewer.getScrollPosition();
      this.options.onReadingPositionObserved?.(filePath, viewer.getReadingPosition());
      this.onActiveViewerStateChange?.();
    });
    viewer.setOnScrollSettled(() => {
      if (this.activeTabId !== id) return;
      this.options.onReadingPositionSettled?.(filePath, viewer.getReadingPosition());
    });
    viewer.setOnPageNavigationRequest(this.options.onPageNavigationRequested ?? null);
    const onZoomIntentRequested = this.options.onZoomIntentRequested;
    viewer.setOnZoomIntentRequest(
      onZoomIntentRequested ? (zoomIntent) => onZoomIntentRequested(filePath, zoomIntent) : null,
    );
    viewer.setAnnotations(this.annotationAuthority.snapshot(filePath));
    viewer.setOnAnnotationsChange((annotations) => {
      this.annotationAuthority.replace(filePath, annotations);
      if (this.activeTabId === id) {
        this.onActiveViewerStateChange?.();
      }
    });

    // Load PDF. Keep tab creation transactional so cancelled passwords or invalid files
    // do not leave a dead tab/surface behind.
    try {
      await viewer.loadPDF(pdfData, title, filePath);
      if (restoredDocument) {
        await projectTabStateToViewer(viewer, tab, restoredDocument.readingPosition);
      } else if (initialPage !== undefined) {
        await viewer.goToPage(initialPage);
        tab.currentPage = viewer.getState().currentPage;
      }
    } catch (error) {
      viewer.destroy();
      await runtime.destroy();
      this.tabs.delete(id);
      this.renderTabs();
      throw error;
    }

    // Store viewer
    this.renderings.set(id, viewer);

    // Hide viewer initially (will be shown when activated)
    viewer.setVisible(false);

    // Render tabs UI
    this.renderTabs();
    this.onTabsChanged?.();

    // Registration and activation are transactional; observers run only after success.
    let prepared = false;
    try {
      await this.options.onDocumentPrepared?.(tab, runtime);
      prepared = true;
      if (activate) {
        await this.activateTab(id, {
          ...(initialPage !== undefined ? { readingPosition: viewer.getReadingPosition() } : {}),
        });
      }
    } catch (error) {
      viewer.destroy();
      this.renderings.delete(id);
      this.tabs.delete(id);
      let restoredTab: TabData | null = null;
      if (this.activeTabId === id) {
        this.activeTabId =
          previousActiveTabId && this.tabs.has(previousActiveTabId) ? previousActiveTabId : null;
        this.renderings.forEach((existingViewer, viewerId) => {
          existingViewer.setVisible(viewerId === this.activeTabId);
        });
        restoredTab = this.activeTabId ? (this.tabs.get(this.activeTabId) ?? null) : null;
      }
      if (prepared) await this.options.onDocumentClosed?.(filePath);
      await runtime.destroy();
      this.renderTabs();
      this.onTabsChanged?.();
      if (restoredTab) {
        try {
          await this.onTabChange(restoredTab);
        } catch (rollbackError) {
          console.error('Failed to restore active Document after intake rollback:', rollbackError);
        }
      }
      throw error;
    }
    if (notifyOpened) {
      await this.notifyDocumentOpened(filePath);
    }

    debugLog(`Created Document: ${title} (${id})`);
    return tab;
  }

  /**
   * Close a tab
   */
  async closeTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (!this.options.onDocumentCloseRequested) {
      throw new Error('Cannot close a Document without Reader Actions');
    }
    await this.options.onDocumentCloseRequested(tab.filePath);
  }

  async projectDocumentClose(
    filePath: string,
    nextActiveDocumentPath: string | null,
  ): Promise<void> {
    const entry = Array.from(this.tabs.entries()).find(([, tab]) => tab.filePath === filePath);
    if (!entry) return;
    const [id, tab] = entry;
    const wasActive = this.activeTabId === id;

    const viewer = this.renderings.get(id);
    if (viewer) {
      viewer.destroy();
      this.renderings.delete(id);
    }

    this.tabs.delete(id);

    if (wasActive) {
      const nextEntry = nextActiveDocumentPath
        ? Array.from(this.tabs.entries()).find(
            ([, item]) => item.filePath === nextActiveDocumentPath,
          )
        : undefined;
      if (nextEntry) {
        await this.activateTabDirect(nextEntry[0]);
      } else {
        this.activeTabId = null;
        await this.onTabChange(null);
      }
    }

    this.renderTabs();
    this.onTabsChanged?.();

    debugLog(`Closed Document: ${tab.title} (${id})`);
  }

  /**
   * Activate a tab
   */
  async activateTab(id: string, options: ActivateTabOptions = {}): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (this.requestActivation) {
      await this.requestActivation(tab.filePath, options.readingPosition);
      return;
    }
    await this.activateTabDirect(id);
  }

  async reactivateOpenDocument(
    id: string,
    { notifyOpened = true }: ReactivateOpenDocumentOptions = {},
  ): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    await this.activateTab(id);
    if (notifyOpened) {
      await this.notifyDocumentOpened(tab.filePath);
    }
  }

  async notifyDocumentOpened(filePath: string): Promise<void> {
    const tab = this.getTabs().find((item) => item.filePath === filePath);
    if (!tab) throw new Error(`Cannot notify for unopened Document: ${filePath}`);
    try {
      await this.options.onDocumentOpened?.(tab);
    } catch (error) {
      console.error('Document Intake observer failed:', error);
    }
  }

  async restoreExistingDocument(
    filePath: string,
    document: ReadingSessionDocument,
    { preserveReadingPosition }: { preserveReadingPosition: boolean },
  ): Promise<ReadingSessionDocument> {
    const tab = this.getTabs().find((item) => item.filePath === filePath);
    if (!tab) throw new Error(`Cannot restore unopened Document: ${filePath}`);
    const viewer = this.renderings.get(tab.id);
    if (!viewer) throw new Error(`Cannot render unopened Document: ${filePath}`);

    const previousDocument: ReadingSessionDocument = {
      filePath: tab.filePath,
      title: tab.title,
      readingPosition: viewer.getReadingPosition(),
      visualState: {
        filterSettings: { ...tab.filterSettings },
        zoomIntent:
          tab.zoomIntent.kind === 'manual'
            ? { kind: 'manual', scale: tab.zoomIntent.scale }
            : { kind: tab.zoomIntent.kind },
        rotation: tab.rotation,
        viewMode: tab.viewMode,
      },
    };
    const restoredDocument: ReadingSessionDocument = {
      ...document,
      filePath,
      readingPosition: preserveReadingPosition
        ? previousDocument.readingPosition
        : document.readingPosition,
    };

    applyProjectedDocumentStateToTab(tab, restoredDocument);
    try {
      await projectTabStateToViewer(viewer, tab, restoredDocument.readingPosition);
    } catch (error) {
      applyProjectedDocumentStateToTab(tab, previousDocument);
      try {
        await projectTabStateToViewer(viewer, tab, previousDocument.readingPosition);
      } catch (rollbackError) {
        console.error('Failed to roll back restored Document state:', rollbackError);
      }
      this.renderTabs();
      if (this.activeTabId === tab.id) this.onActiveViewerStateChange?.();
      throw error;
    }

    this.renderTabs();
    if (this.activeTabId === tab.id) this.onActiveViewerStateChange?.();
    return restoredDocument;
  }

  async requestDocumentPage(filePath: string, page: number): Promise<void> {
    const tab = this.getTabs().find((item) => item.filePath === filePath);
    if (!tab) throw new Error(`Cannot navigate unopened Document: ${filePath}`);
    if (this.options.onDocumentPageRequested) {
      await this.options.onDocumentPageRequested(filePath, page);
      return;
    }
    const viewer = this.renderings.get(tab.id);
    if (!viewer) throw new Error(`Cannot render unopened Document: ${filePath}`);
    await viewer.goToPage(page);
  }

  setActivationRequester(
    requestActivation: (
      filePath: string,
      readingPosition?: RestorableReadingPosition,
    ) => Promise<void>,
  ): void {
    this.requestActivation = requestActivation;
  }

  async projectActiveDocument(
    filePath: string,
    position: RestorableReadingPosition,
    visualState?: {
      filterSettings: Readonly<FilterSettings>;
      zoomIntent: ZoomIntent;
      rotation: number;
      viewMode: ViewMode;
    },
  ): Promise<void> {
    const tab = this.getTabs().find((item) => item.filePath === filePath);
    if (!tab) throw new Error(`Cannot activate unopened Document: ${filePath}`);
    applyProjectedDocumentStateToTab(tab, {
      title: tab.title,
      readingPosition: position,
      visualState,
    });
    await this.activateTabDirect(tab.id);
    const viewer = this.renderings.get(tab.id);
    if (!viewer) throw new Error(`Cannot render unopened Document: ${filePath}`);
    await viewer.goToReadingPosition(position);
  }

  private async activateTabDirect(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;

    if (this.activeTabId && this.activeTabId !== id) {
      const previousTab = this.tabs.get(this.activeTabId);
      const previousViewer = this.renderings.get(this.activeTabId);
      if (previousTab && previousViewer) {
        previousTab.scrollPosition = previousViewer.getScrollPosition();
      }
    }

    // Show/hide all viewers (handles both single-page and continuous scroll modes)
    this.renderings.forEach((viewer, viewerId) => {
      viewer.setVisible(viewerId === id);
    });

    // Update active tab ID
    this.activeTabId = id;

    // Render tabs UI to update active state
    this.renderTabs();

    // Notify callback
    await this.onTabChange(tab);

    debugLog(`Activated Document: ${tab.title} (${id})`);
  }

  /**
   * Get active tab data
   */
  getActiveTab(): TabData | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  getTabs(): TabData[] {
    return Array.from(this.tabs.values());
  }

  setDocumentOrder(filePaths: readonly string[]): void {
    const byPath = new Map(
      Array.from(this.tabs.entries()).map(([id, tab]) => [tab.filePath, [id, tab] as const]),
    );
    const ordered = new Map<string, TabData>();
    for (const filePath of filePaths) {
      const entry = byPath.get(filePath);
      if (!entry) continue;
      ordered.set(entry[0], entry[1]);
      byPath.delete(filePath);
    }
    for (const [id, tab] of byPath.values()) ordered.set(id, tab);
    this.tabs = ordered;
    this.renderTabs();
  }

  /**
   * Get PDF viewer for a specific tab
   */
  getRenderingForTab(id: string): DocumentRendering | null {
    return this.renderings.get(id) || null;
  }

  /**
   * Check if a file is already open
   */
  isFileOpen(filePath: string): boolean {
    for (const tab of this.tabs.values()) {
      if (tab.filePath === filePath) {
        // Focus existing tab
        this.activateTab(tab.id);
        return true;
      }
    }
    return false;
  }

  /**
   * Switch to next tab
   */
  async switchToNext(): Promise<void> {
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;

    const currentIndex = ids.indexOf(this.activeTabId || '');
    const nextIndex = (currentIndex + 1) % ids.length;
    await this.activateTab(ids[nextIndex]);
  }

  /**
   * Switch to previous tab
   */
  async switchToPrevious(): Promise<void> {
    const ids = Array.from(this.tabs.keys());
    if (ids.length <= 1) return;

    const currentIndex = ids.indexOf(this.activeTabId || '');
    const prevIndex = (currentIndex - 1 + ids.length) % ids.length;
    await this.activateTab(ids[prevIndex]);
  }

  /**
   * Switch to tab at specific position (1-9)
   */
  async switchToPosition(position: number): Promise<void> {
    const ids = Array.from(this.tabs.keys());

    if (position === 9) {
      // Last tab
      await this.activateTab(ids[ids.length - 1]);
    } else if (position >= 1 && position <= ids.length) {
      await this.activateTab(ids[position - 1]);
    }
  }

  /**
   * Render tabs in the UI
   */
  private renderTabs(): void {
    const container = document.getElementById('tab-container');
    if (!container) return;
    const workspace = document.getElementById('document-workspace');

    // Clear existing tabs
    container.innerHTML = '';

    // Render each tab
    this.tabs.forEach((tab, id) => {
      const itemElement = document.createElement('div');
      itemElement.className = `tab-item ${id === this.activeTabId ? 'active' : ''}`;

      const tabElement = document.createElement('button');
      tabElement.type = 'button';
      tabElement.className = `tab ${id === this.activeTabId ? 'active' : ''}`;
      tabElement.dataset.tabId = id;
      tabElement.dataset.filePath = tab.filePath;
      tabElement.id = `document-tab-${id}`;
      tabElement.setAttribute('role', 'tab');
      tabElement.setAttribute('aria-selected', id === this.activeTabId ? 'true' : 'false');
      tabElement.setAttribute('aria-controls', 'document-workspace');
      tabElement.tabIndex = id === this.activeTabId ? 0 : -1;
      if (id === this.activeTabId) {
        workspace?.setAttribute('aria-labelledby', tabElement.id);
      }

      // Tab title
      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.title;
      titleSpan.title = tab.title; // Tooltip shows full name
      tabElement.appendChild(titleSpan);
      itemElement.appendChild(tabElement);

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '✕';
      closeBtn.title = 'Close document';
      closeBtn.setAttribute('aria-label', `Close ${tab.title}`);
      closeBtn.tabIndex = id === this.activeTabId ? 0 : -1;
      itemElement.appendChild(closeBtn);

      // Tab click handler
      tabElement.addEventListener('click', () => {
        void this.activateTab(id);
      });

      // Close button handler
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(id);
      });

      container.appendChild(itemElement);
    });

    debugLog(`Rendered ${this.tabs.size} Documents`);
  }

  /**
   * Get total number of tabs
   */
  get size(): number {
    return this.tabs.size;
  }

  /**
   * Get all tab IDs
   */
  getTabIds(): string[] {
    return Array.from(this.tabs.keys());
  }
}
