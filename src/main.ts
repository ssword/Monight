import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-dialog';
import { PRESETS, buildFilterCSS, type FilterSettings } from './scripts/filters';
import { SliderManager } from './scripts/sliders';
import { TabManager, type TabData } from './scripts/tabs';
import './styles/main.css';
import './styles/pdf-viewer.css';
import './styles/configurator.css';
import './styles/tabs.css';
import 'nouislider/dist/nouislider.css';

interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
}

// Global tab manager instance
let tabManager: TabManager | null = null;

// Global slider manager instance
let sliderManager: SliderManager | null = null;

// Detect if we're on macOS
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

console.log('Platform:', navigator.platform, 'isMac:', isMac);

async function getAppInfo(): Promise<AppInfo> {
  try {
    const name = 'Monight (墨页)';
    const version = '1.0.0';
    const tauriVersion = '2.0';

    return { name, version, tauriVersion };
  } catch (error) {
    console.error('Failed to get app info:', error);
    return { name: 'Monight', version: '1.0.0', tauriVersion: 'Unknown' };
  }
}

// Show splash screen
function showSplash(): void {
  const splash = document.getElementById('splash-container');
  const viewer = document.getElementById('viewer-container');
  if (splash) splash.classList.remove('hidden');
  if (viewer) viewer.classList.add('hidden');
}

// Show PDF viewer
function showViewer(): void {
  const splash = document.getElementById('splash-container');
  const viewer = document.getElementById('viewer-container');
  if (splash) splash.classList.add('hidden');
  if (viewer) viewer.classList.remove('hidden');
}

// Open PDF file dialog
async function openPDFFile(): Promise<void> {
  console.log('openPDFFile() called');
  try {
    console.log('Opening file dialog...');
    const selected = await open({
      multiple: true, // Enable multi-select
      filters: [
        {
          name: 'PDF',
          extensions: ['pdf'],
        },
      ],
    });

    console.log('File dialog result:', selected);

    if (!selected) {
      console.log('No file selected');
      return;
    }

    // Handle single or multiple files
    const files = Array.isArray(selected) ? selected : [selected];

    for (const filePath of files) {
      // Check if already open
      if (tabManager?.isFileOpen(filePath)) {
        console.log(`File already open: ${filePath}`);
        continue;
      }

      // Load PDF data
      const pdfData: number[] = await invoke('read_pdf_file', { path: filePath });
      const fileName: string = await invoke('get_file_name', { path: filePath });

      // Create tab (TabManager handles viewer creation)
      await tabManager?.createTab(filePath, fileName, new Uint8Array(pdfData));

      console.log(`Opened PDF: ${fileName}`);
    }

    // Update tab bar visibility
    updateTabBarVisibility();
  } catch (error) {
    console.error('Error opening file:', error);
    alert(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Update tab bar visibility
function updateTabBarVisibility(): void {
  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;

  const hasTab = (tabManager?.size ?? 0) > 0;

  if (hasTab) {
    tabBar.classList.remove('hidden');
  } else {
    tabBar.classList.add('hidden');
  }
}

// Restore tab state (filters, page, zoom)
async function restoreTabState(tab: TabData): Promise<void> {
  const viewer = tabManager?.getViewerForTab(tab.id);
  if (!viewer) return;

  // Apply saved filter
  viewer.applyFilter(buildFilterCSS(tab.filterSettings));

  // Restore page and zoom
  await viewer.goToPage(tab.currentPage);
  await viewer.setZoom(tab.zoom);

  // Update slider if initialized
  if (sliderManager?.isInitialized()) {
    sliderManager.setPreset(tab.filterSettings);
  }

  // Update preset button active state
  updateActivePresetButton(tab.filterSettings);
}

// Save current tab state
function saveCurrentTabState(): void {
  const activeTab = tabManager?.getActiveTab();
  if (!activeTab) return;

  const viewer = tabManager?.getViewerForTab(activeTab.id);
  if (!viewer) return;

  const state = viewer.getState();

  // Save state to tab
  activeTab.currentPage = state.currentPage;
  activeTab.zoom = state.zoom;

  // Save current filter if sliders initialized
  if (sliderManager?.isInitialized()) {
    activeTab.filterSettings = sliderManager.getCurrentSettings();
  }
}

// Update active preset button based on settings
function updateActivePresetButton(settings: FilterSettings): void {
  const buttons = document.querySelectorAll('.preset-btn');

  // Check if settings match any preset
  let matchedPreset: string | null = null;

  for (const [presetName, presetSettings] of Object.entries(PRESETS)) {
    if (JSON.stringify(presetSettings) === JSON.stringify(settings)) {
      matchedPreset = presetName;
      break;
    }
  }

  // Update button states
  buttons.forEach((btn) => {
    const presetName = btn.id.replace('preset-', '');
    if (presetName === matchedPreset) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Update UI based on viewer state
function updateUI(): void {
  const activeTab = tabManager?.getActiveTab();
  if (!activeTab) return;

  const viewer = tabManager?.getViewerForTab(activeTab.id);
  if (!viewer) return;

  const state = viewer.getState();

  // Update page info
  const pageInput = document.getElementById('page-input') as HTMLInputElement;
  const pageCount = document.getElementById('page-count');
  if (pageInput) {
    pageInput.value = state.currentPage.toString();
    pageInput.max = state.totalPages.toString();
  }
  if (pageCount) {
    pageCount.textContent = state.totalPages.toString();
  }

  // Update zoom info
  const zoomInfo = document.getElementById('zoom-info');
  if (zoomInfo) {
    zoomInfo.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  // Update file name
  const fileName = document.getElementById('file-name');
  if (fileName) {
    fileName.textContent = activeTab.title || 'No file loaded';
  }

  // Update button states
  const prevBtn = document.getElementById('prev-page') as HTMLButtonElement;
  const nextBtn = document.getElementById('next-page') as HTMLButtonElement;
  if (prevBtn) {
    prevBtn.disabled = state.currentPage <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = state.currentPage >= state.totalPages;
  }
}

// Toggle dark mode configurator panel
function toggleDarkConfigurator(): void {
  const panel = document.getElementById('darkConfigurator');
  if (!panel) return;

  const isHidden = panel.classList.contains('hidden');

  if (isHidden) {
    panel.classList.remove('hidden');
    // Initialize sliders on first open
    if (sliderManager && !sliderManager.isInitialized()) {
      sliderManager.initialize();
    }
  } else {
    panel.classList.add('hidden');
  }
}

// Setup preset button handlers
function setupPresetButtons(): void {
  const buttons = document.querySelectorAll('.preset-btn');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Extract preset name from button ID (e.g., 'preset-default' -> 'default')
      const presetName = btn.id.replace('preset-', '');

      // Handle custom button - toggle panel
      if (presetName === 'custom') {
        toggleDarkConfigurator();
        // Update active button state
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        return;
      }

      // Get preset settings
      const settings = PRESETS[presetName];
      if (!settings) {
        console.error(`Unknown preset: ${presetName}`);
        return;
      }

      // Build CSS filter string
      const filterCSS = buildFilterCSS(settings);

      // Apply to active tab's PDF viewer
      const activeTab = tabManager?.getActiveTab();
      if (activeTab) {
        const viewer = tabManager?.getViewerForTab(activeTab.id);
        if (viewer) {
          viewer.applyFilter(filterCSS);
          // Save filter to tab state
          activeTab.filterSettings = settings;
        }
      }

      // Update slider positions if initialized
      if (sliderManager?.isInitialized()) {
        sliderManager.setPreset(settings);
      }

      // Update active button state
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      console.log(`Applied preset: ${presetName}`);
    });
  });
}

// Setup event listeners
function setupEventListeners(): void {
  console.log('Setting up event listeners...');

  // Splash screen open button
  const splashOpenBtn = document.getElementById('splash-open-btn');
  if (splashOpenBtn) {
    splashOpenBtn.addEventListener('click', () => {
      console.log('Splash open button clicked');
      openPDFFile();
    });
    console.log('Splash open button listener attached');
  } else {
    console.error('Splash open button not found!');
  }

  // Open file button (in toolbar)
  const openBtn = document.getElementById('open-file');
  openBtn?.addEventListener('click', () => {
    console.log('Open button clicked');
    openPDFFile();
  });

  // Navigation buttons
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  prevBtn?.addEventListener('click', async () => {
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      const viewer = tabManager?.getViewerForTab(activeTab.id);
      if (viewer) {
        await viewer.previousPage();
        saveCurrentTabState();
        updateUI();
      }
    }
  });
  nextBtn?.addEventListener('click', async () => {
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      const viewer = tabManager?.getViewerForTab(activeTab.id);
      if (viewer) {
        await viewer.nextPage();
        saveCurrentTabState();
        updateUI();
      }
    }
  });

  // Page input
  const pageInput = document.getElementById('page-input') as HTMLInputElement;
  pageInput?.addEventListener('change', async () => {
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      const viewer = tabManager?.getViewerForTab(activeTab.id);
      if (viewer) {
        const pageNum = Number.parseInt(pageInput.value, 10);
        const state = viewer.getState();
        if (pageNum >= 1 && pageNum <= state.totalPages) {
          await viewer.goToPage(pageNum);
          saveCurrentTabState();
          updateUI();
        } else {
          pageInput.value = state.currentPage.toString();
        }
      }
    }
  });

  // Zoom buttons
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const fitWidthBtn = document.getElementById('fit-width');
  const fitPageBtn = document.getElementById('fit-page');

  zoomInBtn?.addEventListener('click', async () => {
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      const viewer = tabManager?.getViewerForTab(activeTab.id);
      if (viewer) {
        await viewer.zoomIn();
        saveCurrentTabState();
        updateUI();
      }
    }
  });
  zoomOutBtn?.addEventListener('click', async () => {
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      const viewer = tabManager?.getViewerForTab(activeTab.id);
      if (viewer) {
        await viewer.zoomOut();
        saveCurrentTabState();
        updateUI();
      }
    }
  });
  fitWidthBtn?.addEventListener('click', async () => {
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      const viewer = tabManager?.getViewerForTab(activeTab.id);
      if (viewer) {
        await viewer.fitToWidth();
        saveCurrentTabState();
        updateUI();
      }
    }
  });
  fitPageBtn?.addEventListener('click', async () => {
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      const viewer = tabManager?.getViewerForTab(activeTab.id);
      if (viewer) {
        await viewer.fitToPage();
        saveCurrentTabState();
        updateUI();
      }
    }
  });

  // Setup preset buttons
  setupPresetButtons();

  // New tab button
  const newTabBtn = document.getElementById('new-tab-btn');
  newTabBtn?.addEventListener('click', () => {
    openPDFFile();
  });

  // Close configurator button
  const closeConfigBtn = document.getElementById('close-configurator');
  closeConfigBtn?.addEventListener('click', () => {
    toggleDarkConfigurator();
  });

  // Keyboard shortcuts - use both document and window to ensure capture
  const handleKeyDown = async (e: KeyboardEvent) => {
    console.log('Key pressed:', e.key, 'Meta:', e.metaKey, 'Ctrl:', e.ctrlKey);

    // Use metaKey (Cmd) on Mac, ctrlKey on other platforms
    const modifierKey = isMac ? e.metaKey : e.ctrlKey;

    // Cmd/Ctrl+O: Open file
    if (modifierKey && e.key === 'o') {
      console.log('Cmd/Ctrl+O detected, opening file dialog...');
      e.preventDefault();
      e.stopPropagation();
      await openPDFFile();
      return;
    }

    // Cmd/Ctrl+W: Close tab
    if (modifierKey && e.key === 'w') {
      e.preventDefault();
      const activeTab = tabManager?.getActiveTab();
      if (activeTab) {
        await tabManager?.closeTab(activeTab.id);
        updateTabBarVisibility();
      }
      return;
    }

    // Cmd/Ctrl+Tab: Next tab
    if (modifierKey && e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        await tabManager?.switchToPrevious();
      } else {
        await tabManager?.switchToNext();
      }
      return;
    }

    // Cmd/Ctrl+Shift+T: Reopen closed tab
    if (modifierKey && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      const filePath = await tabManager?.reopenLastClosed();
      if (filePath) {
        // TODO: Implement reopening from file path
        console.log(`Reopening: ${filePath}`);
      }
      return;
    }

    // Cmd/Ctrl+1-9: Switch to tab position
    if (modifierKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      await tabManager?.switchToPosition(parseInt(e.key));
      return;
    }

    // Only handle other shortcuts if tab is active
    const activeTab = tabManager?.getActiveTab();
    if (!activeTab) return;

    const viewer = tabManager?.getViewerForTab(activeTab.id);
    if (!viewer) return;

    // Arrow keys: Navigate pages
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      await viewer.previousPage();
      saveCurrentTabState();
      updateUI();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      await viewer.nextPage();
      saveCurrentTabState();
      updateUI();
    }

    // Cmd/Ctrl+Plus: Zoom in
    else if (modifierKey && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      await viewer.zoomIn();
      saveCurrentTabState();
      updateUI();
    }

    // Cmd/Ctrl+Minus: Zoom out
    else if (modifierKey && e.key === '-') {
      e.preventDefault();
      await viewer.zoomOut();
      saveCurrentTabState();
      updateUI();
    }

    // Cmd/Ctrl+0: Reset zoom
    else if (modifierKey && e.key === '0') {
      e.preventDefault();
      await viewer.setZoom(1.0);
      saveCurrentTabState();
      updateUI();
    }
  };

  // Add to both document and window for maximum compatibility
  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keydown', handleKeyDown);
  console.log('Keyboard event listeners attached');
}

// Update keyboard shortcut hints based on platform
function updateKeyboardHints(): void {
  const modKey = isMac ? 'Cmd' : 'Ctrl';

  // Update tooltips
  const openBtn = document.getElementById('open-file');
  if (openBtn) openBtn.title = `Open PDF (${modKey}+O)`;

  const zoomInBtn = document.getElementById('zoom-in');
  if (zoomInBtn) zoomInBtn.title = `Zoom In (${modKey}++)`;

  const zoomOutBtn = document.getElementById('zoom-out');
  if (zoomOutBtn) zoomOutBtn.title = `Zoom Out (${modKey}+-)`;

  // Update hint text
  const hintText = document.querySelector('.hint-text');
  if (hintText) hintText.textContent = `Press ${modKey}+O to open a PDF file`;
}

async function initializeApp(): Promise<void> {
  try {
    console.log('Initializing app...');

    // Get app information
    const info = await getAppInfo();

    // Update version display
    const versionElement = document.getElementById('version-info');
    if (versionElement) {
      versionElement.textContent = `v${info.version} • Tauri ${info.tauriVersion}`;
    }

    // Initialize tab manager
    tabManager = new TabManager(async (tab: TabData | null) => {
      if (tab) {
        // Tab activated - restore its state
        await restoreTabState(tab);
        updateUI();
        showViewer();
      } else {
        // No tabs - show splash
        showSplash();
      }
      updateTabBarVisibility();
    });

    // Initialize slider manager
    sliderManager = new SliderManager((settings) => {
      const activeTab = tabManager?.getActiveTab();
      if (activeTab) {
        const viewer = tabManager?.getViewerForTab(activeTab.id);
        if (viewer) {
          const filterCSS = buildFilterCSS(settings);
          viewer.applyFilter(filterCSS);
          // Save filter to tab state
          activeTab.filterSettings = settings;
        }
      }
    });

    // Setup event listeners
    setupEventListeners();

    // Update keyboard hints for platform
    updateKeyboardHints();

    // Show splash screen initially
    showSplash();

    // Get current window
    const currentWindow = getCurrentWebviewWindow();

    // Show window after initialization
    await currentWindow.show();
    await currentWindow.setFocus();

    console.log(`${info.name} initialized successfully!`);
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
