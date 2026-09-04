import { debugLog } from '../lib/debug-log';
import { type DispatchReaderAction, readerAction } from '../reader/reader-actions';
import type { KeybindManager } from '../scripts/keybind-manager';
import type { SliderManager } from '../scripts/sliders';
import type { TabManager } from '../scripts/tabs';
import { setupPresetButtons, toggleDarkConfigurator } from './presets';
import { withActiveViewer } from './viewer-helpers';

interface DomEventContext {
  tabManager: TabManager | null;
  sliderManager: SliderManager | null;
  keybindManager: KeybindManager | null;
  openPdfAndRefresh: () => Promise<void>;
  updateUI: () => void;
  activateDocument: (filePath: string) => Promise<void>;
  openRecentFile: (filePath: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  goToRelativePage: (direction: 'next' | 'previous') => Promise<void>;
  dispatchReaderAction: DispatchReaderAction;
}

// Setup event listeners
export function setupEventListeners({
  tabManager,
  sliderManager,
  keybindManager,
  openPdfAndRefresh,
  updateUI,
  activateDocument,
  openRecentFile,
  clearRecentFiles,
  goToPage,
  goToRelativePage,
  dispatchReaderAction,
}: DomEventContext): void {
  debugLog('Setting up event listeners...');

  // Splash screen open button
  const splashOpenBtn = document.getElementById('splash-open-btn');
  if (splashOpenBtn) {
    splashOpenBtn.addEventListener('click', () => {
      debugLog('Splash open button clicked');
      openPdfAndRefresh();
    });
    debugLog('Splash open button listener attached');
  } else {
    console.error('Splash open button not found!');
  }

  document.getElementById('recent-files-list')?.addEventListener('click', (event) => {
    const target = event.target;
    const button =
      target instanceof Element ? target.closest<HTMLButtonElement>('[data-file-path]') : null;
    const filePath = button?.dataset.filePath;
    if (filePath) void openRecentFile(filePath);
  });
  document.getElementById('clear-recent-files')?.addEventListener('click', () => {
    void clearRecentFiles();
  });

  // Open file button (in toolbar)
  const openBtn = document.getElementById('open-file');
  openBtn?.addEventListener('click', () => {
    debugLog('Open button clicked');
    openPdfAndRefresh();
  });

  // Print button
  const printBtn = document.getElementById('print-file');
  printBtn?.addEventListener('click', () => {
    debugLog('Print button clicked');
    void dispatchReaderAction({ type: 'printDocument' });
  });

  // Navigation buttons
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  prevBtn?.addEventListener('click', () => {
    void goToRelativePage('previous').then(() => {
      updateUI();
    });
  });
  nextBtn?.addEventListener('click', () => {
    void goToRelativePage('next').then(() => {
      updateUI();
    });
  });

  // Page input
  const pageInput = document.getElementById('page-input') as HTMLInputElement | null;
  pageInput?.addEventListener('change', () => {
    withActiveViewer(tabManager, async (viewer) => {
      if (!pageInput) return;
      const pageNum = Number.parseInt(pageInput.value, 10);
      const state = viewer.getState();
      if (pageNum >= 1 && pageNum <= state.totalPages) {
        await goToPage(pageNum);
        updateUI();
      } else {
        pageInput.value = state.currentPage.toString();
      }
    });
  });

  // Zoom buttons
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const fitWidthBtn = document.getElementById('fit-width');
  const fitPageBtn = document.getElementById('fit-page');

  zoomInBtn?.addEventListener('click', () => {
    void dispatchReaderAction(readerAction.zoomIn());
  });
  zoomOutBtn?.addEventListener('click', () => {
    void dispatchReaderAction(readerAction.zoomOut());
  });
  fitWidthBtn?.addEventListener('click', () => {
    void dispatchReaderAction(readerAction.setZoomIntent({ kind: 'fit-width' }));
  });
  fitPageBtn?.addEventListener('click', () => {
    void dispatchReaderAction(readerAction.setZoomIntent({ kind: 'fit-page' }));
  });

  // View mode toggle button
  const toggleViewModeBtn = document.getElementById('toggle-view-mode');
  toggleViewModeBtn?.addEventListener('click', () => {
    void dispatchReaderAction(readerAction.cycleViewMode());
  });

  // Setup preset buttons
  setupPresetButtons(sliderManager, (settings) => {
    void dispatchReaderAction(readerAction.setFilterSettings(settings));
  });

  // New tab button
  const newTabBtn = document.getElementById('new-tab-btn');
  newTabBtn?.addEventListener('click', () => {
    openPdfAndRefresh();
  });

  // Close configurator button
  const closeConfigBtn = document.getElementById('close-configurator');
  closeConfigBtn?.addEventListener('click', () => {
    toggleDarkConfigurator(sliderManager);
  });

  const tabContainer = document.getElementById('tab-container');
  tabContainer?.addEventListener('keydown', (event) => {
    const focusedTab =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[role="tab"]') : null;
    if (!focusedTab) return;

    const tabs = Array.from(tabContainer.querySelectorAll<HTMLElement>('[role="tab"]'));
    const currentIndex = tabs.indexOf(focusedTab);
    let targetTab: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowLeft':
        targetTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
        break;
      case 'ArrowRight':
        targetTab = tabs[(currentIndex + 1) % tabs.length];
        break;
      case 'Home':
        targetTab = tabs[0];
        break;
      case 'End':
        targetTab = tabs[tabs.length - 1];
        break;
      default:
        return;
    }

    const tabId = targetTab?.dataset.tabId;
    const filePath = targetTab?.dataset.filePath;
    if (!tabId || !filePath) return;
    event.preventDefault();
    event.stopPropagation();
    void activateDocument(filePath).then(() => {
      document.getElementById(`document-tab-${tabId}`)?.focus();
    });
  });

  // Keyboard shortcuts - use KeybindManager for dynamic keybind handling
  const handleKeyDown = async (e: KeyboardEvent) => {
    if (!keybindManager) return;

    const actionId = keybindManager.matchEvent(e);
    if (actionId) {
      debugLog(`Keybind matched: ${actionId}`);
      e.preventDefault();
      e.stopPropagation();
      await keybindManager.handleEvent(e);
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  debugLog('Keyboard event listeners attached');
}
