import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { buildFilterCSS } from './scripts/filters';
import { KeybindManager } from './scripts/keybind-manager';
import { SettingsManager } from './scripts/settings';
import { SliderManager } from './scripts/sliders';
import { TabManager, type TabData } from './scripts/tabs';
import { setupEventListeners } from './app/dom-events';
import {
  ensureMinimumViewingSize,
  openPDFFile,
  openSettings,
  printCurrentPDF,
  updatePrintMenuState,
} from './app/file-actions';
import { registerKeybindActions } from './app/keybinds';
import { restoreTabState, saveCurrentTabState } from './app/tab-state';
import { setupTauriListeners } from './app/tauri-events';
import {
  showSplash,
  showViewer,
  updateKeyboardHints,
  updateTabBarVisibility,
  updateUI,
} from './app/ui';
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

// Global settings manager instance
let settingsManager: SettingsManager | null = null;

// Global keybind manager instance
let keybindManager: KeybindManager | null = null;

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

const refreshAfterOpen = async (): Promise<void> => {
  updateTabBarVisibility(tabManager);
  await updatePrintMenuState(tabManager);
  await ensureMinimumViewingSize();
};

const openPdfAndRefresh = async (): Promise<void> => {
  if (!tabManager) return;
  const opened = await openPDFFile(tabManager);
  if (opened > 0) {
    await refreshAfterOpen();
  }
};

async function initializeApp(): Promise<void> {
  try {
    console.log('Initializing app...');

    // Initialize settings manager
    settingsManager = new SettingsManager();
    const settings = await settingsManager.load();
    console.log('Settings loaded:', settings);

    // Initialize tab manager
    tabManager = new TabManager(async (tab: TabData | null) => {
      if (tab) {
        // Tab activated - restore its state
        await restoreTabState(tabManager, sliderManager, tab);
        updateUI(tabManager);
        showViewer();
      } else {
        // No tabs - show splash
        showSplash();
      }
      updateTabBarVisibility(tabManager);
      // Update print menu state
      await updatePrintMenuState(tabManager);
    });

    // Initialize slider manager
    sliderManager = new SliderManager((filterSettings) => {
      const activeTab = tabManager?.getActiveTab();
      if (activeTab) {
        const viewer = tabManager?.getViewerForTab(activeTab.id);
        if (viewer) {
          const filterCSS = buildFilterCSS(filterSettings);
          viewer.applyFilter(filterCSS);
          // Save filter to tab state
          activeTab.filterSettings = filterSettings;
        }
      }
    });

    // Initialize keybind manager
    keybindManager = new KeybindManager(isMac);

    const updateUIForTab = () => updateUI(tabManager);
    const saveStateForTab = () => saveCurrentTabState(tabManager, sliderManager);
    const updateTabBar = () => updateTabBarVisibility(tabManager);

    // Register all action handlers
    registerKeybindActions({
      keybindManager,
      tabManager,
      openPdfAndRefresh,
      printCurrentPDF: () => printCurrentPDF(tabManager),
      openSettings,
      updateTabBarVisibility: updateTabBar,
      saveCurrentTabState: saveStateForTab,
      updateUI: updateUIForTab,
    });

    // Load keybinds from settings
    // Override Settings keybind for macOS with Cmd+,
    if (isMac && settings.keybinds.Settings) {
      settings.keybinds.Settings.binds = ['Cmd+,'];
    }
    keybindManager.loadFromSettings(settings);
    console.log('KeybindManager initialized with settings keybinds');

    // Get app information
    const info = await getAppInfo();

    // Update version display
    const versionElement = document.getElementById('version-info');
    if (versionElement) {
      versionElement.textContent = `v${info.version} • Tauri ${info.tauriVersion}`;
    }

    // Setup event listeners
    setupEventListeners({
      tabManager,
      sliderManager,
      keybindManager,
      openPdfAndRefresh,
      printCurrentPDF: () => printCurrentPDF(tabManager),
      saveCurrentTabState: saveStateForTab,
      updateUI: updateUIForTab,
    });

    // Update keyboard hints for platform
    updateKeyboardHints(isMac);

    // Listen for Tauri events
    await setupTauriListeners({
      tabManager,
      settingsManager,
      keybindManager,
      isMac,
      openPdfAndRefresh,
      updateTabBarVisibility: updateTabBar,
      updatePrintMenuState: () => updatePrintMenuState(tabManager),
      ensureMinimumViewingSize,
      updateUI: updateUIForTab,
      saveCurrentTabState: saveStateForTab,
      printCurrentPDF: () => printCurrentPDF(tabManager),
    });

    // Show splash screen initially
    showSplash();

    // Get current window
    const currentWindow = getCurrentWebviewWindow();

    // Maximize on open if setting is enabled
    if (settings.general.maximizeOnOpen) {
      await currentWindow.maximize();
      console.log('Window maximized on startup');
    }

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
