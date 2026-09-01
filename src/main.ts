import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { requestAnnotationNote, requestPdfPassword, showToast } from './app/dialogs';
import { setupEventListeners } from './app/dom-events';
import {
  ensureMinimumViewingSize,
  openFiles,
  openPDFFile,
  openSettings,
  printCurrentPDF,
  updatePrintMenuState,
} from './app/file-actions';
import { registerKeybindActions } from './app/keybinds';
import { PresentationController } from './app/presentation-controller';
import { createReadingSessionStorage } from './app/reading-session-storage';
import { SearchController } from './app/search-controller';
import { restoreReadingSession } from './app/session-state';
import { SidebarController } from './app/sidebar-controller';
import { restoreTabState, saveCurrentTabState } from './app/tab-state';
import { setupTauriListeners } from './app/tauri-events';
import {
  renderRecentFiles,
  showSplash,
  showViewer,
  updateKeyboardHints,
  updateTabBarVisibility,
  updateUI,
} from './app/ui';
import {
  type PdfAnnotation,
  type RecentFile,
  updateRecentFiles,
  type ViewMode,
} from './lib/document-features';
import {
  createReaderActions,
  type PersistedReadingSession,
  type ReaderActions,
} from './reader/reader-actions';
import { loadReadingSession, type ReadingSessionStorage } from './reader/reading-session-store';
import { buildFilterCSS, type FilterSettings, PRESETS } from './scripts/filters';
import { KeybindManager } from './scripts/keybind-manager';
import { type MoonightSettings, SettingsManager } from './scripts/settings';
import { SliderManager } from './scripts/sliders';
import { type TabData, TabManager } from './scripts/tabs';
import './styles/main.css';
import './styles/pdf-viewer.css';
import './styles/configurator.css';
import './styles/document-features.css';
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
let readerActions: ReaderActions | null = null;
let readingSessionStorage: ReadingSessionStorage | null = null;
let restoredReadingSession: PersistedReadingSession | null = null;

// Global keybind manager instance
let keybindManager: KeybindManager | null = null;
let searchController: SearchController | null = null;
let sidebarController: SidebarController | null = null;
let presentationController: PresentationController | null = null;

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

const getInitialViewMode = (): ViewMode => {
  if (!currentSettings) {
    return 'single';
  }

  return currentSettings.general.defaultViewMode ?? 'single';
};

let lastFilterSaveTimer: number | null = null;
let sessionSaveTimer: number | null = null;
let annotationSaveTimer: number | null = null;
let isRestoringSession = false;

const getActiveViewer = () => {
  const activeTab = tabManager?.getActiveTab();
  return activeTab ? (tabManager?.getViewerForTab(activeTab.id) ?? null) : null;
};

const goToPage = async (page: number): Promise<void> => {
  await readerActions?.dispatch({ type: 'goToPage', page });
};

const persistAnnotations = (filePath: string, annotations: PdfAnnotation[]): void => {
  const manager = settingsManager;
  if (!manager || !currentSettings) return;

  const annotationMap = {
    ...currentSettings.annotations,
    [filePath]: annotations,
  };
  currentSettings = { ...currentSettings, annotations: annotationMap };
  if (annotationSaveTimer !== null) window.clearTimeout(annotationSaveTimer);
  annotationSaveTimer = window.setTimeout(async () => {
    try {
      await manager.set('annotations', currentSettings?.annotations ?? {});
    } catch (error) {
      console.error('Failed to save annotations:', error);
      showToast('Could not save annotations.', 'error');
    } finally {
      annotationSaveTimer = null;
    }
  }, 200);
};

const rememberRecentFile = (filePath: string, title: string): void => {
  const manager = settingsManager;
  if (!manager || !currentSettings) return;
  const opened: RecentFile = { filePath, title, openedAt: Date.now() };
  const recentFiles = updateRecentFiles(currentSettings.recentFiles, opened);
  currentSettings = { ...currentSettings, recentFiles };
  renderRecentFiles(recentFiles);
  void manager.set('recentFiles', recentFiles).catch((error) => {
    console.error('Failed to save recent files:', error);
  });
};

const clearRecentFiles = async (): Promise<void> => {
  if (!settingsManager || !currentSettings) return;
  currentSettings = { ...currentSettings, recentFiles: [] };
  renderRecentFiles([]);
  await settingsManager.set('recentFiles', []);
};

const openRecentFile = async (filePath: string): Promise<void> => {
  if (!tabManager) return;
  try {
    await openFiles([filePath], {
      tabManager,
      initialFilterSettings: getInitialFilterSettings(),
      initialViewMode: getInitialViewMode(),
    });
    showViewer();
    await refreshAfterOpen();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (!message.includes('Password entry cancelled')) {
      showToast(`Could not open recent file: ${message}`, 'error');
    }
  }
};

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
  if (
    !readingSessionStorage ||
    !readerActions ||
    !currentSettings?.general.restorePreviousSession ||
    isRestoringSession
  ) {
    return;
  }

  saveCurrentTabState(tabManager, sliderManager);
  await readingSessionStorage.write(readerActions.snapshot());
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

  const session = restoredReadingSession;
  if (!session?.documents.length) return 0;
  const legacyProjection = {
    version: 1 as const,
    activeFilePath: session.activeDocumentPath,
    tabs: session.documents.map((document) => ({
      filePath: document.filePath,
      title: document.title,
      filterSettings: document.visualState?.filterSettings ?? getInitialFilterSettings(),
      currentPage: document.readingPosition.page,
      zoom: document.visualState?.zoom ?? 1,
      rotation: document.visualState?.rotation ?? 0,
      scrollPosition: 0,
      viewMode: document.visualState?.viewMode ?? getInitialViewMode(),
    })),
  };

  isRestoringSession = true;
  try {
    const result = await restoreReadingSession(legacyProjection, {
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
    readingSessionStorage = createReadingSessionStorage(settingsManager);
    try {
      restoredReadingSession = await loadReadingSession(readingSessionStorage);
    } catch (error) {
      console.error('Reading Session migration failed; legacy data was retained:', error);
      restoredReadingSession = {
        schemaVersion: 1,
        activeDocumentPath: null,
        documents: [],
      };
    }
    renderRecentFiles(settings.recentFiles);
    console.log('Settings loaded:', settings);

    // Initialize tab manager
    tabManager = new TabManager(
      async (tab: TabData | null) => {
        if (tab) {
          // Reveal the already-rendered first page while any remaining state/layout is restored.
          showViewer();
          await restoreTabState(tabManager, sliderManager, tab);
          updateUI(tabManager);
        } else {
          // No tabs - show splash
          showSplash();
        }
        searchController?.activeDocumentChanged();
        sidebarController?.activeDocumentChanged();
        updateTabBarVisibility(tabManager);
        // Update print menu state
        await updatePrintMenuState(tabManager);
        scheduleReadingSessionSave();
      },
      () => {
        saveCurrentTabState(tabManager, sliderManager);
        updateUI(tabManager);
        sidebarController?.viewerStateChanged();
        scheduleReadingSessionSave();
      },
      scheduleReadingSessionSave,
      {
        getAnnotations: (filePath) => currentSettings?.annotations[filePath] ?? [],
        onAnnotationsChanged: (filePath, annotations) => {
          persistAnnotations(filePath, annotations);
          sidebarController?.annotationsChanged();
        },
        onDocumentOpened: async (tab) => {
          await readerActions?.dispatch({
            type: 'registerDocument',
            document: {
              filePath: tab.filePath,
              title: tab.title,
              readingPosition: { page: tab.currentPage, location: 0 },
              visualState: {
                filterSettings: tab.filterSettings,
                zoom: tab.zoom,
                rotation: tab.rotation,
                viewMode: tab.viewMode,
              },
            },
          });
          if (!isRestoringSession) rememberRecentFile(tab.filePath, tab.title);
        },
        onDocumentClosed: async (filePath) => {
          await readerActions?.dispatch({ type: 'removeDocument', filePath });
        },
        onReadingPositionSettled: (filePath, readingPosition) => {
          void readerActions?.dispatch({
            type: 'settleReadingPosition',
            filePath,
            readingPosition,
          });
        },
        onPageNavigationRequested: goToPage,
        requestPassword: requestPdfPassword,
        requestAnnotationNote,
      },
    );

    readerActions = createReaderActions({
      initialSession: restoredReadingSession,
      projection: {
        activateDocument: async (filePath, position) => {
          await tabManager?.projectActiveDocument(filePath, position);
        },
        goToReadingPosition: async (filePath, position) => {
          const tab = tabManager?.getTabs().find((item) => item.filePath === filePath);
          const viewer = tab ? tabManager?.getViewerForTab(tab.id) : null;
          if (!viewer) throw new Error(`Cannot navigate unopened Document: ${filePath}`);
          await viewer.goToReadingPosition(position);
        },
      },
      persist: async (snapshot) => {
        if (currentSettings?.general.restorePreviousSession) {
          await readingSessionStorage?.write(snapshot);
        }
      },
    });
    readerActions.observe((snapshot) => {
      for (const document of snapshot.documents) {
        const tab = tabManager?.getTabs().find((item) => item.filePath === document.filePath);
        if (!tab) continue;
        tab.currentPage = document.readingPosition.page;
        if (document.visualState) {
          tab.filterSettings = { ...document.visualState.filterSettings };
          tab.zoom = document.visualState.zoom;
          tab.rotation = document.visualState.rotation;
          tab.viewMode = document.visualState.viewMode;
        }
      }
      updateUI(tabManager);
    });
    tabManager.setActivationRequester(async (filePath) => {
      await readerActions?.dispatch({ type: 'activateDocument', filePath });
    });

    searchController = new SearchController(getActiveViewer);
    sidebarController = new SidebarController({
      getActiveViewer,
      requestAnnotationNote,
    });
    sidebarController.setThumbnailsEnabled(settings.general.displayThumbs);
    presentationController = new PresentationController({
      getActiveViewer,
      onStateChanged: () => {
        saveCurrentTabState(tabManager, sliderManager);
        updateUI(tabManager);
        scheduleReadingSessionSave();
      },
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
      openSearch: () => searchController?.open(),
      togglePresentationMode: async () => {
        await presentationController?.toggle();
      },
      goToPage,
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
      openRecentFile,
      clearRecentFiles,
      goToPage,
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
        renderRecentFiles(updated.recentFiles);
        sidebarController?.setThumbnailsEnabled(updated.general.displayThumbs);
        if (!updated.general.rememberLastFilter && lastFilterSaveTimer !== null) {
          clearTimeout(lastFilterSaveTimer);
          lastFilterSaveTimer = null;
        }
        if (!updated.general.restorePreviousSession) {
          if (sessionSaveTimer !== null) {
            clearTimeout(sessionSaveTimer);
            sessionSaveTimer = null;
          }
          await settingsManager.clearPersistedReadingSession();
          restoredReadingSession = {
            schemaVersion: 1,
            activeDocumentPath: null,
            documents: [],
          };
        } else {
          scheduleReadingSessionSave();
        }
      },
      readingHistoryCleared: () => {
        if (!currentSettings) return;
        currentSettings = { ...currentSettings, recentFiles: [], annotations: {} };
        restoredReadingSession = {
          schemaVersion: 1,
          activeDocumentPath: null,
          documents: [],
        };
        renderRecentFiles([]);
        for (const tab of tabManager?.getTabs() ?? []) {
          tab.annotations = [];
          tabManager?.getViewerForTab(tab.id)?.setAnnotations([]);
        }
        sidebarController?.annotationsChanged();
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
