import { PDFViewer } from './pdf-viewer';
import { PRESETS, type FilterSettings } from './filters';

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
  scrollPosition: number; // Scroll position (future use)
}

/**
 * Manages multiple PDF tabs with individual state
 */
export class TabManager {
  private tabs: Map<string, TabData> = new Map();
  private activeTabId: string | null = null;
  private pdfViewers: Map<string, PDFViewer> = new Map();
  private closedHistory: string[] = [];
  private onTabChange: (tab: TabData | null) => void;

  constructor(onTabChange: (tab: TabData | null) => void) {
    this.onTabChange = onTabChange;
  }

  /**
   * Create a new tab
   */
  async createTab(
    filePath: string,
    title: string,
    pdfData: Uint8Array,
    filterSettings?: FilterSettings,
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
      scrollPosition: 0,
    };

    // Store tab
    this.tabs.set(id, tab);

    // Create PDF viewer for this tab
    const canvasId = `pdf-canvas-${id}`;
    const viewer = new PDFViewer('pdf-container', canvasId);

    // Load PDF
    await viewer.loadPDF(pdfData, title, filePath);

    // Store viewer
    this.pdfViewers.set(id, viewer);

    // Hide canvas initially (will be shown when activated)
    const canvas = viewer.getCanvas();
    if (canvas) {
      canvas.style.display = 'none';
    }

    // Render tabs UI
    this.renderTabs();

    // Activate the new tab (this will show its canvas)
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

    // If closing active tab, activate adjacent tab
    if (this.activeTabId === id) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        // Activate adjacent tab
        await this.activateTab(remaining[0]);
      } else {
        // No tabs left
        this.activeTabId = null;
        this.onTabChange(null);
      }
    }

    // Render tabs UI
    this.renderTabs();

    console.log(`Closed tab: ${tab.title} (${id})`);
  }

  /**
   * Activate a tab
   */
  async activateTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;

    // Hide all canvases
    this.pdfViewers.forEach((viewer, viewerId) => {
      const canvas = viewer.getCanvas();
      if (canvas) {
        canvas.style.display = viewerId === id ? 'block' : 'none';
      }
    });

    // Update active tab ID
    this.activeTabId = id;

    // Render tabs UI to update active state
    this.renderTabs();

    // Notify callback
    this.onTabChange(tab);

    console.log(`Activated tab: ${tab.title} (${id})`);
  }

  /**
   * Get active tab data
   */
  getActiveTab(): TabData | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
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
