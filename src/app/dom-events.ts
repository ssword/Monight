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
  printCurrentPDF: () => Promise<void>;
  saveCurrentTabState: () => void;
  updateUI: () => void;
}

// Setup event listeners
export function setupEventListeners({
  tabManager,
  sliderManager,
  keybindManager,
  openPdfAndRefresh,
  printCurrentPDF,
  saveCurrentTabState,
  updateUI,
}: DomEventContext): void {
  console.log('Setting up event listeners...');

  // Splash screen open button
  const splashOpenBtn = document.getElementById('splash-open-btn');
  if (splashOpenBtn) {
    splashOpenBtn.addEventListener('click', () => {
      console.log('Splash open button clicked');
      openPdfAndRefresh();
    });
    console.log('Splash open button listener attached');
  } else {
    console.error('Splash open button not found!');
  }

  // Open file button (in toolbar)
  const openBtn = document.getElementById('open-file');
  openBtn?.addEventListener('click', () => {
    console.log('Open button clicked');
    openPdfAndRefresh();
  });

  // Print button
  const printBtn = document.getElementById('print-file');
  printBtn?.addEventListener('click', () => {
    console.log('Print button clicked');
    printCurrentPDF();
  });

  // Navigation buttons
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  prevBtn?.addEventListener('click', () => {
    withActiveViewer(tabManager, async (viewer) => {
      await viewer.previousPage();
      saveCurrentTabState();
      updateUI();
    });
  });
  nextBtn?.addEventListener('click', () => {
    withActiveViewer(tabManager, async (viewer) => {
      await viewer.nextPage();
      saveCurrentTabState();
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
        await viewer.goToPage(pageNum);
        saveCurrentTabState();
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
    withActiveViewer(tabManager, async (viewer) => {
      await viewer.zoomIn();
      saveCurrentTabState();
      updateUI();
    });
  });
  zoomOutBtn?.addEventListener('click', () => {
    withActiveViewer(tabManager, async (viewer) => {
      await viewer.zoomOut();
      saveCurrentTabState();
      updateUI();
    });
  });
  fitWidthBtn?.addEventListener('click', () => {
    withActiveViewer(tabManager, async (viewer) => {
      await viewer.fitToWidth();
      saveCurrentTabState();
      updateUI();
    });
  });
  fitPageBtn?.addEventListener('click', () => {
    withActiveViewer(tabManager, async (viewer) => {
      await viewer.fitToPage();
      saveCurrentTabState();
      updateUI();
    });
  });

  // Setup preset buttons
  setupPresetButtons(tabManager, sliderManager);

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

  // Keyboard shortcuts - use KeybindManager for dynamic keybind handling
  const handleKeyDown = async (e: KeyboardEvent) => {
    if (!keybindManager) return;

    const actionId = keybindManager.matchEvent(e);
    if (actionId) {
      console.log(`Keybind matched: ${actionId}`);
      e.preventDefault();
      e.stopPropagation();
      await keybindManager.handleEvent(e);
    }
  };

  // Add to both document and window for maximum compatibility
  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keydown', handleKeyDown);
  console.log('Keyboard event listeners attached');
}
