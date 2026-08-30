import type { PdfAnnotation, ViewMode } from '../lib/document-features';
import type { ReadingPosition } from '../reader/reader-actions';
import { type FilterSettings, PRESETS } from './filters';
import { type AnnotationNoteRequester, PDFViewer, type PdfPasswordRequester } from './pdf-viewer';

/**
 * Data structure for a single tab
 */
export interface TabData {
  id: string; // Unique UUID
  title: string; // Filename for display
  filePath: string; // Full file path
  pdfData: Uint8Array; // PDF binary data
  filterSettings: FilterSettings; // Current filter preset
  currentPage: number; // Current page number
  zoom: number; // Current zoom level
  rotation: number; // Clockwise page rotation in degrees
  scrollPosition: number; // Scroll position
  viewMode: ViewMode; // View mode
  annotations: PdfAnnotation[];
}

interface TabManagerOptions {
  getAnnotations?: (filePath: string) => readonly PdfAnnotation[];
  onAnnotationsChanged?: (filePath: string, annotations: PdfAnnotation[]) => void;
  onDocumentOpened?: (tab: TabData) => void | Promise<void>;
  onDocumentClosed?: (filePath: string) => void | Promise<void>;
  onReadingPositionSettled?: (filePath: string, position: ReadingPosition) => void;
  onPageNavigationRequested?: (page: number) => Promise<void>;
  requestPassword?: PdfPasswordRequester;
  requestAnnotationNote?: AnnotationNoteRequester;
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
  ): Promise<TabData> {
    const id = crypto.randomUUID();
    const initialFilterSettings = filterSettings ?? PRESETS.default;

    // Create tab data
    const tab: TabData = {
      id,
      title,
      filePath,
      pdfData,
      filterSettings: { ...initialFilterSettings },
      currentPage: 1,
      zoom: 1.0,
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
    });
    viewer.setOnPageChange(() => {
      if (this.activeTabId !== id) return;
      this.onActiveViewerStateChange?.();
    });
    viewer.setOnScrollChange(() => {
      if (this.activeTabId !== id) return;
      tab.scrollPosition = viewer.getScrollPosition();
      this.onActiveViewerStateChange?.();
    });
    viewer.setOnScrollSettled(() => {
      if (this.activeTabId !== id) return;
      this.options.onReadingPositionSettled?.(filePath, viewer.getReadingPosition());
    });
    viewer.setOnPageNavigationRequest(this.options.onPageNavigationRequested ?? null);
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

    // Activate the new tab (this will show its canvas)
    await this.options.onDocumentOpened?.(tab);
    await this.activateTab(id);

    console.log(`Created tab: ${title} (${id})`);
    return tab;
  }

  /**
   * Close a tab
   */
  async closeTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;

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
        // Activate adjacent tab
        await this.activateTab(remaining[0]);
      } else {
        // No tabs left
        this.activeTabId = null;
        await this.onTabChange(null);
      }
    }

    // Render tabs UI
    this.renderTabs();
    this.onTabsChanged?.();

    console.log(`Closed tab: ${tab.title} (${id})`);
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

  setActivationRequester(requestActivation: (filePath: string) => Promise<void>): void {
    this.requestActivation = requestActivation;
  }

  async projectActiveDocument(filePath: string, position: ReadingPosition): Promise<void> {
    const tab = this.getTabs().find((item) => item.filePath === filePath);
    if (!tab) throw new Error(`Cannot activate unopened Document: ${filePath}`);
    tab.currentPage = position.page;
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

    console.log(`Activated tab: ${tab.title} (${id})`);
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

    // Clear existing tabs
    container.innerHTML = '';

    // Render each tab
    this.tabs.forEach((tab, id) => {
      const tabElement = document.createElement('div');
      tabElement.className = `tab ${id === this.activeTabId ? 'active' : ''}`;
      tabElement.dataset.tabId = id;

      // Tab title
      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.title;
      titleSpan.title = tab.title; // Tooltip shows full name
      tabElement.appendChild(titleSpan);

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '✕';
      closeBtn.title = 'Close tab';
      tabElement.appendChild(closeBtn);

      // Tab click handler
      tabElement.addEventListener('click', (e) => {
        // Don't activate if clicking close button
        if (e.target === closeBtn) return;
        this.activateTab(id);
      });

      // Close button handler
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(id);
      });

      container.appendChild(tabElement);
    });

    console.log(`Rendered ${this.tabs.size} tabs`);
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
