import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  requestAnnotationNote,
  requestConfirmation,
  requestPdfPassword,
  showToast,
} from './app/dialogs';
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
import { createTauriPdfSource } from './app/pdf-source';
import { PresentationController } from './app/presentation-controller';
import { createReadingSessionStorage } from './app/reading-session-storage';
import { SearchController } from './app/search-controller';
import { restoreDocumentStateInTabManager } from './app/session-restoration-runtime';
import { SidebarController } from './app/sidebar-controller';
import { restoreTabState } from './app/tab-state';
import { setupTauriListeners } from './app/tauri-events';
import {
  renderRecentFiles,
  showSplash,
  showViewer,
  updateKeyboardHints,
  updateTabBarVisibility,
  updateUI,
} from './app/ui';
import { registerReadingSessionCloseGuard } from './app/window-lifecycle';
import { debugLog } from './lib/debug-log';
import {
  type PdfAnnotation,
  type RecentFile,
  updateRecentFiles,
  type ViewMode,
} from './lib/document-features';
import { createDocumentIntake } from './reader/document-intake';
import {
  createReaderActions,
  type PersistedReadingSession,
  type ReaderAction,
  type ReaderActionOptions,
  type ReaderActions,
  readerAction,
} from './reader/reader-actions';
import { loadReadingSession, type ReadingSessionStorage } from './reader/reading-session-store';
import { buildFilterCSS, type FilterSettings, PRESETS } from './scripts/filters';
import { KeybindManager } from './scripts/keybind-manager';
import { type MoonightSettings, SettingsManager } from './scripts/settings';
import { SliderManager } from './scripts/sliders';
import { type TabData, TabManager } from './scripts/tabs';
import './styles/main.css';
import './styles/dialogs.css';
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

debugLog('Platform:', navigator.platform, 'isMac:', isMac);

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
    return { name: 'Monight', version: 'Unknown', tauriVersion: 'Unknown' };
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
let annotationSaveTimer: number | null = null;
let isRestoringSession = false;
let preserveStartupForegroundReadingPosition = false;

const getActiveViewer = () => {
  const activeTab = tabManager?.getActiveTab();
  return activeTab ? (tabManager?.getViewerForTab(activeTab.id) ?? null) : null;
};

const getDocumentViewer = (filePath: string) => {
  const tab = tabManager?.getTabs().find((item) => item.filePath === filePath);
  const viewer = tab ? tabManager?.getViewerForTab(tab.id) : null;
  if (!viewer) throw new Error(`Cannot project unopened Document: ${filePath}`);
  return viewer;
};

const goToPage = async (page: number, options?: ReaderActionOptions): Promise<void> => {
  const outcome = await readerActions?.dispatch({ type: 'goToPage', page }, options);
  if (outcome?.status === 'failure') throw outcome.error;
};

const goToRelativePage = async (direction: 'next' | 'previous'): Promise<void> => {
  const outcome = await readerActions?.dispatch({
    type: direction === 'next' ? 'goToNextPage' : 'goToPreviousPage',
  });
  if (outcome?.status === 'failure') throw outcome.error;
};

const dispatchReaderAction = async (action: ReaderAction): Promise<void> => {
  const outcome = await readerActions?.dispatch(action);
  if (outcome?.status === 'failure') throw outcome.error;
  if (action.type === 'setFilterSettings' && outcome?.status === 'committed') {
    scheduleLastFilterSave(action.filterSettings);
  }
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
      showToast(`Could not open Recent Document: ${message}`, 'error');
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

  const activeTab = tabManager?.getActiveTab();
  const activeViewer = activeTab ? tabManager?.getViewerForTab(activeTab.id) : null;
  if (activeTab && activeViewer) {
    await readerActions.dispatch({
      type: 'settleReadingPosition',
      filePath: activeTab.filePath,
      readingPosition: activeViewer.getReadingPosition(),
    });
  }

  await readerActions.flush();
};

const restorePreviousReadingSession = async (): Promise<number> => {
  if (!tabManager || !currentSettings?.general.restorePreviousSession) return 0;
  const manager = tabManager;

  const session = restoredReadingSession;
  if (!session?.documents.length) return 0;

  isRestoringSession = true;
  try {
    const foregroundDocumentPath = tabManager.getActiveTab()?.filePath ?? null;
    const intake = createDocumentIntake({
      source: createTauriPdfSource(),
      runtime: {
        isOpen: (filePath) => manager.getTabs().some((tab) => tab.filePath === filePath),
        activate: async (filePath) => {
          const tab = manager.getTabs().find((item) => item.filePath === filePath);
          if (!tab) return;
          await manager.reactivateOpenDocument(tab.id);
        },
        open: async (document, bytes, activate, initialPage) => {
          await manager.createTab(
            document.canonicalPath,
            document.title,
            bytes,
            getInitialFilterSettings(),
            getInitialViewMode(),
            { activate, initialPage },
          );
        },
        goToPage: async (filePath, page) => {
          await manager.requestDocumentPage(filePath, page);
        },
        restoreDocumentState: async (document, options) =>
          restoreDocumentStateInTabManager(
            {
              tabManager: manager,
              sliderManager,
              getInitialFilterSettings,
              getInitialViewMode,
            },
            document,
            options,
          ),
        setDocumentOrder: (filePaths) => {
          manager.setDocumentOrder(filePaths);
        },
      },
    });
    const result = await intake.restore(session, {
      foregroundDocumentPath,
      preserveForegroundReadingPosition: preserveStartupForegroundReadingPosition,
    });

    if (result.failed > 0) {
      showToast(
        `Skipped ${result.failed} Document${result.failed === 1 ? '' : 's'} while restoring the previous Reading Session.`,
        'error',
      );
      for (const filePath of result.failedPaths) {
        await readerActions?.dispatch({ type: 'removeDocument', filePath });
      }
    }

    if (result.opened > 0) {
      updateTabBarVisibility(tabManager);
      await updatePrintMenuState(tabManager);
      await applyWindowAfterOpen();
    }

    return result.opened;
  } finally {
    preserveStartupForegroundReadingPosition = false;
    isRestoringSession = false;
  }
};

async function initializeApp(): Promise<void> {
  try {
    debugLog('Initializing app...');

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
        schemaVersion: 2,
        activeDocumentPath: null,
        documents: [],
      };
    }
    renderRecentFiles(settings.recentFiles);
    debugLog('Settings loaded:', settings);

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
      },
      () => {
        updateUI(tabManager);
        sidebarController?.viewerStateChanged();
      },
      undefined,
      {
        getAnnotations: (filePath) => currentSettings?.annotations[filePath] ?? [],
        onAnnotationsChanged: (filePath, annotations) => {
          persistAnnotations(filePath, annotations);
          sidebarController?.annotationsChanged();
        },
        onDocumentPrepared: async (tab) => {
          const outcome = await readerActions?.dispatch({
            type: 'registerDocument',
            document: {
              filePath: tab.filePath,
              title: tab.title,
              readingPosition: { page: tab.currentPage, location: 0 },
              visualState: {
                filterSettings: tab.filterSettings,
                zoomIntent: tab.zoomIntent,
                rotation: tab.rotation,
                viewMode: tab.viewMode,
              },
            },
          });
          if (outcome?.status === 'failure') throw outcome.error;
        },
        onDocumentOpened: (tab) => {
          if (!isRestoringSession) rememberRecentFile(tab.filePath, tab.title);
        },
        onDocumentClosed: async (filePath) => {
          await readerActions?.dispatch({ type: 'removeDocument', filePath });
        },
        onReadingPositionObserved: (filePath, readingPosition) => {
          void readerActions?.dispatch({
            type: 'settleReadingPosition',
            filePath,
            readingPosition,
          });
        },
        onReadingPositionSettled: (filePath, readingPosition) => {
          void readerActions?.dispatch({
            type: 'settleReadingPosition',
            filePath,
            readingPosition,
          });
        },
        onPageNavigationRequested: goToPage,
        onDocumentPageRequested: async (filePath, page) => {
          const outcome = await readerActions?.dispatch({ type: 'goToPage', filePath, page });
          if (outcome?.status === 'failure') throw outcome.error;
        },
        onZoomIntentRequested: async (filePath, zoomIntent) => {
          await dispatchReaderAction(readerAction.setZoomIntent(zoomIntent, filePath));
        },
        requestPassword: requestPdfPassword,
        requestAnnotationNote,
        reportError: (message) => showToast(message, 'error'),
        beforeDocumentTransition: async () => {
          await presentationController?.exit();
        },
      },
    );

    readerActions = createReaderActions({
      initialSession: restoredReadingSession,
      defaultVisualState: {
        filterSettings: getInitialFilterSettings(),
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: getInitialViewMode(),
      },
      projection: {
        exitPresentation: async () => {
          await presentationController?.exit();
        },
        activateDocument: async (filePath, position, visualState) => {
          await tabManager?.projectActiveDocument(filePath, position, visualState);
        },
        goToReadingPosition: async (filePath, position, options) => {
          await getDocumentViewer(filePath).goToReadingPosition(position, options);
        },
        getPageCount: (filePath) => {
          const tab = tabManager?.getTabs().find((item) => item.filePath === filePath);
          return tab ? (tabManager?.getViewerForTab(tab.id)?.getState().totalPages ?? 0) : 0;
        },
        applyZoomIntent: async (filePath, zoomIntent) => {
          const viewer = getDocumentViewer(filePath);
          await viewer.setZoomIntent(zoomIntent);
          return viewer.getState().zoomIntent;
        },
        applyRelativeZoom: async (filePath, direction) => {
          const viewer = getDocumentViewer(filePath);
          await (direction === 'in' ? viewer.zoomIn() : viewer.zoomOut());
          return viewer.getState().zoomIntent;
        },
        applyRotation: async (filePath, rotation) => {
          await getDocumentViewer(filePath).setRotation(rotation);
        },
        applyViewMode: async (filePath, viewMode) => {
          await getDocumentViewer(filePath).setViewMode(viewMode);
        },
        applyFilterSettings: async (filePath, filterSettings) => {
          getDocumentViewer(filePath).applyFilter(buildFilterCSS(filterSettings));
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
          tab.zoomIntent = document.visualState.zoomIntent;
          if (document.visualState.zoomIntent.kind === 'manual') {
            tab.zoom = document.visualState.zoomIntent.scale;
          }
          tab.rotation = document.visualState.rotation;
          tab.viewMode = document.visualState.viewMode;
        }
      }
      updateUI(tabManager);
    });
    tabManager.setActivationRequester(async (filePath) => {
      const outcome = await readerActions?.dispatch({ type: 'activateDocument', filePath });
      if (outcome?.status === 'failure') throw outcome.error;
    });

    searchController = new SearchController(getActiveViewer);
    sidebarController = new SidebarController({
      getActiveViewer,
      requestAnnotationNote,
    });
    sidebarController.setThumbnailsEnabled(settings.general.displayThumbs);
    presentationController = new PresentationController({
      getActiveViewer,
      onStateChanged: (active) => {
        updateUI(tabManager);
        if (!active) sidebarController?.viewerStateChanged();
      },
    });

    // Initialize slider manager
    sliderManager = new SliderManager((filterSettings) => {
      void dispatchReaderAction(readerAction.setFilterSettings(filterSettings));
    });

    // Initialize keybind manager
    keybindManager = new KeybindManager(isMac);

    const updateUIForTab = () => updateUI(tabManager);
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
      updateUI: updateUIForTab,
      openSearch: () => searchController?.open(),
      togglePresentationMode: async () => {
        await presentationController?.toggle();
      },
      goToPage,
      goToRelativePage,
      dispatchReaderAction,
    });

    // Load keybinds from settings
    // Override Settings keybind for macOS with Cmd+,
    if (isMac && settings.keybinds.Settings) {
      settings.keybinds.Settings.binds = ['Cmd+,'];
    }
    keybindManager.loadFromSettings(settings);
    debugLog('KeybindManager initialized with settings keybinds');

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
      updateUI: updateUIForTab,
      activateDocument: async (filePath) => {
        await readerActions?.dispatch({ type: 'activateDocument', filePath });
      },
      openRecentFile,
      clearRecentFiles,
      goToPage,
      goToRelativePage,
      dispatchReaderAction,
    });

    // Update keyboard hints for platform
    updateKeyboardHints(isMac);

    // Listen before restoration so an explicit startup Document wins foreground precedence.
    await setupTauriListeners({
      tabManager,
      settingsManager,
      keybindManager,
      isMac,
      openPdfAndRefresh,
      getInitialFilterSettings,
      getInitialViewMode,
      reportStartupIntent: (payload) => {
        preserveStartupForegroundReadingPosition = (payload.page ?? 0) > 0;
      },
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
          await settingsManager.clearPersistedReadingSession();
          restoredReadingSession = {
            schemaVersion: 2,
            activeDocumentPath: null,
            documents: [],
          };
        }
      },
      readingHistoryCleared: () => {
        if (!currentSettings) return;
        currentSettings = { ...currentSettings, recentFiles: [], annotations: {} };
        restoredReadingSession = {
          schemaVersion: 2,
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
      printCurrentPDF: () => printCurrentPDF(tabManager),
      dispatchReaderAction,
    });

    // Restore the saved active Document next, then the remaining Documents in saved order.
    await restorePreviousReadingSession();

    // Show the correct initial surface after session/CLI restore has run.
    if ((tabManager?.size ?? 0) > 0) {
      showViewer();
    } else {
      showSplash();
    }

    // Get current window
    const currentWindow = getCurrentWebviewWindow();

    await registerReadingSessionCloseGuard(
      currentWindow,
      async () => {
        await saveReadingSessionNow();
      },
      async () =>
        (await requestConfirmation({
          title: 'Reading Session not saved',
          message: 'Monight could not save your latest reading state.',
          confirmLabel: 'Retry save',
          cancelLabel: 'Quit without saving',
        }))
          ? 'retry'
          : 'discard',
    );

    // Show window after initialization
    await currentWindow.show();
    await currentWindow.setFocus();

    debugLog(`${info.name} initialized successfully!`);
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
