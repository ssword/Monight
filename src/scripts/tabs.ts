import { debugLog } from '../lib/debug-log';
import type { PdfAnnotation, ViewMode } from '../lib/document-features';
import type {
  ReaderActionOptions,
  ReadingPosition,
  RestorableReadingPosition,
  ZoomIntent,
} from '../reader/reader-actions';
import { type FilterSettings, PRESETS } from './filters';
import { type AnnotationNoteRequester, PDFViewer, type PdfPasswordRequester } from './pdf-viewer';

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
  annotations: PdfAnnotation[];
}

interface TabManagerOptions {
  getAnnotations?: (filePath: string) => readonly PdfAnnotation[];
  onAnnotationsChanged?: (filePath: string, annotations: PdfAnnotation[]) => void;
  onDocumentPrepared?: (tab: TabData) => void | Promise<void>;
  onDocumentOpened?: (tab: TabData) => void | Promise<void>;
  onDocumentClosed?: (filePath: string) => void | Promise<void>;
  onReadingPositionObserved?: (filePath: string, position: ReadingPosition) => void;
  onReadingPositionSettled?: (filePath: string, position: ReadingPosition) => void;
  onPageNavigationRequested?: (page: number, options?: ReaderActionOptions) => Promise<void>;
  onDocumentPageRequested?: (filePath: string, page: number) => Promise<void>;
  onZoomIntentRequested?: (filePath: string, zoomIntent: ZoomIntent) => Promise<void>;
  requestPassword?: PdfPasswordRequester;
  requestAnnotationNote?: AnnotationNoteRequester;
  reportError?: (message: string) => void;
  beforeDocumentTransition?: () => Promise<void>;
}

interface CreateTabOptions {
  activate?: boolean;
  initialPage?: number;
}

/**
 * Manages multiple PDF tabs with individual state
 */
export class TabManager {
  private tabs: Map<string, TabData> = new Map();
  private activeTabId: string | null = null;
  private pdfViewers: Map<string, PDFViewer> = new Map();
  private closedHistory: string[] = [];
  private onTabChange: (tab: TabData | null) => void | Promise<void>;
  private onActiveViewerStateChange?: () => void;
  private onTabsChanged?: () => void;
  private options: TabManagerOptions;
  private requestActivation: ((filePath: string) => Promise<void>) | null = null;

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
    { activate = true, initialPage }: CreateTabOptions = {},
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
      annotations:
        this.options.getAnnotations?.(filePath).map((annotation) => ({
          ...annotation,
          rects: annotation.rects.map((rect) => ({ ...rect })),
        })) ?? [],
    };

    // Store tab
    this.tabs.set(id, tab);

    // Create PDF viewer for this tab
    const canvasId = `pdf-canvas-${id}`;
    const viewer = new PDFViewer('pdf-container', canvasId, {
      requestPassword: this.options.requestPassword,
      requestAnnotationNote: this.options.requestAnnotationNote,
      reportError: this.options.reportError,
    });
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
    viewer.setAnnotations(tab.annotations);
    viewer.setOnAnnotationsChange((annotations) => {
      tab.annotations = annotations;
      this.options.onAnnotationsChanged?.(filePath, annotations);
      if (this.activeTabId === id) {
        this.onActiveViewerStateChange?.();
      }
    });

    // Load PDF. Keep tab creation transactional so cancelled passwords or invalid files
    // do not leave a dead tab/surface behind.
    try {
      await viewer.loadPDF(pdfData, title, filePath);
      if (initialPage !== undefined) {
        await viewer.goToPage(initialPage);
        tab.currentPage = viewer.getState().currentPage;
      }
    } catch (error) {
      viewer.destroy();
      this.tabs.delete(id);
      this.renderTabs();
      throw error;
    }

    // Store viewer
    this.pdfViewers.set(id, viewer);

    // Hide viewer initially (will be shown when activated)
    viewer.setVisible(false);

    // Render tabs UI
    this.renderTabs();
    this.onTabsChanged?.();

    // Registration and activation are transactional; observers run only after success.
    let prepared = false;
    try {
      await this.options.onDocumentPrepared?.(tab);
      prepared = true;
      if (activate) await this.activateTab(id);
    } catch (error) {
      viewer.destroy();
      this.pdfViewers.delete(id);
      this.tabs.delete(id);
      let restoredTab: TabData | null = null;
      if (this.activeTabId === id) {
        this.activeTabId =
          previousActiveTabId && this.tabs.has(previousActiveTabId) ? previousActiveTabId : null;
        this.pdfViewers.forEach((existingViewer, viewerId) => {
          existingViewer.setVisible(viewerId === this.activeTabId);
        });
        restoredTab = this.activeTabId ? (this.tabs.get(this.activeTabId) ?? null) : null;
      }
      if (prepared) await this.options.onDocumentClosed?.(filePath);
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
    try {
      await this.options.onDocumentOpened?.(tab);
    } catch (error) {
      console.error('Document Intake observer failed:', error);
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
    const orderedIds = Array.from(this.tabs.keys());
    const closedIndex = orderedIds.indexOf(id);
    await this.options.beforeDocumentTransition?.();

    // Add to closed history
    this.closedHistory.push(tab.filePath);

    // Destroy PDF viewer
    const viewer = this.pdfViewers.get(id);
    if (viewer) {
      viewer.destroy();
      this.pdfViewers.delete(id);
    }

    // Remove tab
    this.tabs.delete(id);
    await this.options.onDocumentClosed?.(tab.filePath);

    // If closing active tab, activate adjacent tab
    if (this.activeTabId === id) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        const adjacentId = remaining[Math.min(closedIndex, remaining.length - 1)];
        await this.activateTab(adjacentId);
      } else {
        // No tabs left
        this.activeTabId = null;
        await this.onTabChange(null);
      }
    }

    // Render tabs UI
    this.renderTabs();
    this.onTabsChanged?.();

    debugLog(`Closed Document: ${tab.title} (${id})`);
  }

  /**
   * Activate a tab
   */
  async activateTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (this.requestActivation) {
      await this.requestActivation(tab.filePath);
      return;
    }
    await this.activateTabDirect(id);
  }

  async reactivateOpenDocument(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    await this.activateTab(id);
    try {
      await this.options.onDocumentOpened?.(tab);
    } catch (error) {
      console.error('Document Intake observer failed:', error);
    }
  }

  async requestDocumentPage(filePath: string, page: number): Promise<void> {
    const tab = this.getTabs().find((item) => item.filePath === filePath);
    if (!tab) throw new Error(`Cannot navigate unopened Document: ${filePath}`);
    if (this.options.onDocumentPageRequested) {
      await this.options.onDocumentPageRequested(filePath, page);
      return;
    }
    const viewer = this.pdfViewers.get(tab.id);
    if (!viewer) throw new Error(`Cannot render unopened Document: ${filePath}`);
    await viewer.goToPage(page);
  }

  setActivationRequester(requestActivation: (filePath: string) => Promise<void>): void {
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
    tab.currentPage = position.page;
    if (visualState) {
      tab.filterSettings = { ...visualState.filterSettings };
      tab.zoomIntent = visualState.zoomIntent;
      if (visualState.zoomIntent.kind === 'manual') tab.zoom = visualState.zoomIntent.scale;
      tab.rotation = visualState.rotation;
      tab.viewMode = visualState.viewMode;
    }
    await this.activateTabDirect(tab.id);
    const viewer = this.pdfViewers.get(tab.id);
    if (!viewer) throw new Error(`Cannot render unopened Document: ${filePath}`);
    await viewer.goToReadingPosition(position);
  }

  private async activateTabDirect(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;

    if (this.activeTabId && this.activeTabId !== id) {
      const previousTab = this.tabs.get(this.activeTabId);
      const previousViewer = this.pdfViewers.get(this.activeTabId);
      if (previousTab && previousViewer) {
        previousTab.scrollPosition = previousViewer.getScrollPosition();
      }
    }

    // Show/hide all viewers (handles both single-page and continuous scroll modes)
    this.pdfViewers.forEach((viewer, viewerId) => {
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
  getViewerForTab(id: string): PDFViewer | null {
    return this.pdfViewers.get(id) || null;
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
   * Reopen last closed tab
   */
  async reopenLastClosed(): Promise<string | null> {
    const filePath = this.closedHistory.pop();
    return filePath || null;
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
