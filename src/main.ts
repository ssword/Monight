import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { setupEventListeners } from './app/dom-events';
import {
  ensureMinimumViewingSize,
  openPDFFile,
  openSettings,
  printCurrentPDF,
  updatePrintMenuState,
} from './app/file-actions';
import { registerKeybindActions } from './app/keybinds';
import { captureReadingSession, restoreReadingSession } from './app/session-state';
import { restoreTabState, saveCurrentTabState } from './app/tab-state';
import { setupTauriListeners } from './app/tauri-events';
import {
  showSplash,
  showViewer,
  updateKeyboardHints,
  updateTabBarVisibility,
  updateUI,
} from './app/ui';
import { buildFilterCSS, type FilterSettings, PRESETS } from './scripts/filters';
import { KeybindManager } from './scripts/keybind-manager';
import { type MoonightSettings, SettingsManager } from './scripts/settings';
import { SliderManager } from './scripts/sliders';
import { type TabData, TabManager } from './scripts/tabs';
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
let currentSettings: MoonightSettings | null = null;

// Global keybind manager instance
let keybindManager: KeybindManager | null = null;

// Detect if we're on macOS
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

console.log('Platform:', navigator.platform, 'isMac:', isMac);

async function getAppInfo(): Promise<AppInfo> {
  try {
    const [name, version, tauriVersion] = await Promise.all([
      getName(),
      getVersion(),
      getTauriVersion(),
    ]);

    return { name, version, tauriVersion };
  } catch (error) {
    console.error('Failed to get app info:', error);
    return { name: 'Monight', version: '1.0.6', tauriVersion: 'Unknown' };
  }
}

const applyWindowAfterOpen = async (): Promise<void> => {
  await ensureMinimumViewingSize({
    fillAvailableHeight: currentSettings?.general.maximizeOnOpen ?? false,
  });
};

const refreshAfterOpen = async (): Promise<void> => {
  updateTabBarVisibility(tabManager);
  await updatePrintMenuState(tabManager);
  await applyWindowAfterOpen();
};

const openPdfAndRefresh = async (): Promise<void> => {
  if (!tabManager) return;
  const opened = await openPDFFile(tabManager, getInitialFilterSettings(), getInitialViewMode());
  if (opened > 0) {
    await refreshAfterOpen();
  }
};

const getInitialFilterSettings = (): FilterSettings => {
  if (!currentSettings) {
    return { ...PRESETS.default };
  }

  if (currentSettings.general.rememberLastFilter && currentSettings.lastFilter) {
    return { ...currentSettings.lastFilter };
  }

  const preset = PRESETS[currentSettings.general.defaultDarkMode];
  return { ...(preset ?? PRESETS.default) };
};

const getInitialViewMode = (): 'single' | 'continuous' => {
  if (!currentSettings) {
    return 'single';
  }

  return currentSettings.general.defaultViewMode ?? 'single';
};

let lastFilterSaveTimer: number | null = null;
let sessionSaveTimer: number | null = null;
let isRestoringSession = false;

const scheduleLastFilterSave = (settings: FilterSettings): void => {
  const manager = settingsManager;
  if (!manager || !currentSettings?.general.rememberLastFilter) return;

  currentSettings = { ...currentSettings, lastFilter: settings };

  if (lastFilterSaveTimer !== null) {
    clearTimeout(lastFilterSaveTimer);
  }

  lastFilterSaveTimer = window.setTimeout(async () => {
    try {
      await manager.set('lastFilter', settings);
    } catch (error) {
      console.error('Failed to save last filter settings:', error);
    } finally {
      lastFilterSaveTimer = null;
    }
  }, 250);
};

const saveReadingSessionNow = async (): Promise<void> => {
  const manager = settingsManager;
  if (!manager || !currentSettings?.general.restorePreviousSession || isRestoringSession) return;

  saveCurrentTabState(tabManager, sliderManager);
  const session = captureReadingSession(tabManager);
  currentSettings = { ...currentSettings, lastSession: session };
  await manager.set('lastSession', session);
};

const scheduleReadingSessionSave = (): void => {
  if (!settingsManager || !currentSettings?.general.restorePreviousSession || isRestoringSession) {
    return;
  }

  if (sessionSaveTimer !== null) {
    clearTimeout(sessionSaveTimer);
  }

  sessionSaveTimer = window.setTimeout(async () => {
    try {
      await saveReadingSessionNow();
    } catch (error) {
      console.error('Failed to save reading session:', error);
    } finally {
      sessionSaveTimer = null;
    }
  }, 250);
};

const restorePreviousReadingSession = async (): Promise<number> => {
  if (!tabManager || !currentSettings?.general.restorePreviousSession) return 0;

  const session = currentSettings.lastSession;
  if (!session?.tabs.length) return 0;

  isRestoringSession = true;
  try {
    const result = await restoreReadingSession(session, {
      tabManager,
      sliderManager,
      getInitialFilterSettings,
      getInitialViewMode,
    });

    if (result.failed > 0) {
      console.warn(`Skipped ${result.failed} PDF(s) while restoring the previous session.`);
    }

    if (result.opened > 0) {
      updateTabBarVisibility(tabManager);
      await updatePrintMenuState(tabManager);
      await applyWindowAfterOpen();
    }

    return result.opened;
  } finally {
    isRestoringSession = false;
    scheduleReadingSessionSave();
  }
};

async function initializeApp(): Promise<void> {
  try {
    console.log('Initializing app...');

    // Initialize settings manager
    settingsManager = new SettingsManager();
    const settings = await settingsManager.load();
    currentSettings = settings;
    console.log('Settings loaded:', settings);

    // Initialize tab manager
    tabManager = new TabManager(
      async (tab: TabData | null) => {
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
        scheduleReadingSessionSave();
      },
      () => {
        saveCurrentTabState(tabManager, sliderManager);
        updateUI(tabManager);
        scheduleReadingSessionSave();
      },
      scheduleReadingSessionSave,
    );

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
          scheduleLastFilterSave(filterSettings);
          scheduleReadingSessionSave();
        }
      }
    });

    // Initialize keybind manager
    keybindManager = new KeybindManager(isMac);

    const updateUIForTab = () => updateUI(tabManager);
    const saveStateForTab = () => {
      saveCurrentTabState(tabManager, sliderManager);
      scheduleReadingSessionSave();
    };
    const updateTabBar = () => updateTabBarVisibility(tabManager);

    // Register all action handlers
    registerKeybindActions({
      keybindManager,
      tabManager,
      openPdfAndRefresh,
      printCurrentPDF: () => printCurrentPDF(tabManager),
      openSettings,
      getInitialFilterSettings,
      getInitialViewMode,
      applyWindowAfterOpen,
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
      onPresetApplied: scheduleLastFilterSave,
      saveCurrentTabState: saveStateForTab,
      updateUI: updateUIForTab,
    });

    // Update keyboard hints for platform
    updateKeyboardHints(isMac);

    // Restore saved tabs before processing pending OS/CLI file-open events.
    await restorePreviousReadingSession();

    // Listen for Tauri events
    await setupTauriListeners({
      tabManager,
      settingsManager,
      keybindManager,
      isMac,
      openPdfAndRefresh,
      getInitialFilterSettings,
      getInitialViewMode,
      reloadSettings: async () => {
        if (!settingsManager) return;
        const updated = await settingsManager.load();
        if (isMac && updated.keybinds.Settings) {
          updated.keybinds.Settings.binds = ['Cmd+,'];
        }
        currentSettings = updated;
        if (!updated.general.rememberLastFilter && lastFilterSaveTimer !== null) {
          clearTimeout(lastFilterSaveTimer);
          lastFilterSaveTimer = null;
        }
        if (!updated.general.restorePreviousSession && sessionSaveTimer !== null) {
          clearTimeout(sessionSaveTimer);
          sessionSaveTimer = null;
        }
        if (updated.general.restorePreviousSession) {
          scheduleReadingSessionSave();
        }
      },
      applyWindowAfterOpen,
      updateTabBarVisibility: updateTabBar,
      updatePrintMenuState: () => updatePrintMenuState(tabManager),
      updateUI: updateUIForTab,
      saveCurrentTabState: saveStateForTab,
      printCurrentPDF: () => printCurrentPDF(tabManager),
    });

    // Show the correct initial surface after session/CLI restore has run.
    if ((tabManager?.size ?? 0) > 0) {
      showViewer();
    } else {
      showSplash();
    }

    // Get current window
    const currentWindow = getCurrentWebviewWindow();

    window.addEventListener('beforeunload', () => {
      void saveReadingSessionNow();
    });

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
