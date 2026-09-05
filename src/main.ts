import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { createAnnotationStorage } from './app/annotation-storage';
import { browserPrintAdapter } from './app/browser-print-adapter';
import {
  requestAnnotationNote,
  requestConfirmation,
  requestPdfPassword,
  showToast,
} from './app/dialogs';
import { createDocumentIntakeRuntime } from './app/document-intake-runtime';
import { setupEventListeners } from './app/dom-events';
import {
  ensureMinimumViewingSize,
  openFiles,
  openPDFFile,
  openSettings,
  reportDocumentIntakeOutcomes,
  updatePrintMenuState,
} from './app/file-actions';
import { registerKeybindActions } from './app/keybinds';
import { PresentationController } from './app/presentation-controller';
import { createReadingSessionStorage } from './app/reading-session-storage';
import { createRecentDocumentStorage } from './app/recent-document-storage';
import { SearchController } from './app/search-controller';
import { SidebarController } from './app/sidebar-controller';
import { restoreReadingSessionAtStartup } from './app/startup-restoration';
import { restoreTabState } from './app/tab-state';
import { type ExternalOpenPayload, setupTauriListeners } from './app/tauri-events';
import {
  renderRecentFiles,
  showSplash,
  showViewer,
  updateKeyboardHints,
  updateTabBarVisibility,
  updateUI,
} from './app/ui';
import {
  type FinalSaveFailureChoice,
  finishPendingReaderState,
  registerReadingSessionCloseGuard,
} from './app/window-lifecycle';
import { debugLog } from './lib/debug-log';
import type { ViewMode } from './lib/document-features';
import type { PdfLinkTarget } from './lib/pdf-links';
import { type AnnotationAuthority, loadAnnotations } from './reader/annotations';
import {
  createReaderActions,
  type PersistedReadingSession,
  type ReaderAction,
  type ReaderActionOptions,
  type ReaderActions,
  readerAction,
} from './reader/reader-actions';
import {
  EMPTY_READING_SESSION,
  loadReadingSession,
  type ReadingSessionStorage,
} from './reader/reading-session-store';
import { loadRecentDocuments, type RecentDocumentAuthority } from './reader/recent-documents';
import { buildFilterCSS, type FilterSettings, PRESETS } from './scripts/filters';
import { KeybindManager } from './scripts/keybind-manager';
import { type MoonightSettings, SettingsManager } from './scripts/settings';
import { SliderManager } from './scripts/sliders';
import { applyProjectedDocumentStateToTab } from './scripts/tab-reading-session';
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
let annotationAuthority: AnnotationAuthority | null = null;
let recentDocumentAuthority: RecentDocumentAuthority | null = null;

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
let isRestoringSession = false;

const getActiveViewer = () => {
  const activeTab = tabManager?.getActiveTab();
  return activeTab ? (tabManager?.getRenderingForTab(activeTab.id) ?? null) : null;
};

const getActiveDocumentAccess = () => {
  const rendering = getActiveViewer();
  const query = readerActions?.query();
  return rendering && query
    ? { query, rendering, navigateToPage: (pageNumber: number) => goToPage(pageNumber) }
    : null;
};

const getDocumentViewer = (filePath: string) => {
  const tab = tabManager?.getTabs().find((item) => item.filePath === filePath);
  const viewer = tab ? tabManager?.getRenderingForTab(tab.id) : null;
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
  if (outcome?.status === 'failure') {
    if (action.type === 'printDocument') {
      console.error('Print error:', outcome.error);
      showToast(
        `Failed to print: ${outcome.error instanceof Error ? outcome.error.message : 'Unknown error'}`,
        'error',
      );
      return;
    }
    throw outcome.error;
  }
  if (action.type === 'printDocument' && outcome?.status === 'no-op') {
    showToast('No PDF is currently open.', 'error');
  }
  if (action.type === 'setFilterSettings' && outcome?.status === 'committed') {
    scheduleLastFilterSave(action.filterSettings);
  }
};

const resolveDocumentLinkTarget = async (filePath: string, target: PdfLinkTarget) => {
  return (await readerActions?.query(filePath)?.resolveLinkTarget(target)) ?? null;
};

const rememberRecentDocument = (filePath: string, title: string): void => {
  recentDocumentAuthority?.record({ filePath, title, openedAt: Date.now() });
};

const clearRecentFiles = async (): Promise<void> => {
  recentDocumentAuthority?.clear();
  await recentDocumentAuthority?.flush();
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

const flushReaderState = async (): Promise<void> => {
  if (
    readingSessionStorage &&
    readerActions &&
    currentSettings?.general.restorePreviousSession &&
    !isRestoringSession
  ) {
    const activeTab = tabManager?.getActiveTab();
    const activeViewer = activeTab ? tabManager?.getRenderingForTab(activeTab.id) : null;
    if (activeTab && activeViewer) {
      await readerActions.dispatch({
        type: 'settleReadingPosition',
        filePath: activeTab.filePath,
        readingPosition: activeViewer.getReadingPosition(),
      });
    }

    await readerActions.flush();
  }

  await annotationAuthority?.flush();
  await recentDocumentAuthority?.flush();
};

const chooseAfterFinalSaveFailure = async (): Promise<FinalSaveFailureChoice> =>
  (await requestConfirmation({
    title: 'Reader state not saved',
    message: 'Monight could not save the latest Reading Session, Recent Documents, or Annotations.',
    confirmLabel: 'Retry save',
    cancelLabel: 'Quit without saving',
  }))
    ? 'retry'
    : 'discard';

const restoreStartupReadingSession = async (
  payloads: readonly ExternalOpenPayload[],
): Promise<number> => {
  if (!tabManager) return 0;
  const manager = tabManager;
  const session = currentSettings?.general.restorePreviousSession
    ? (restoredReadingSession ?? EMPTY_READING_SESSION)
    : EMPTY_READING_SESSION;
  if (session.documents.length === 0 && payloads.length === 0) return 0;

  isRestoringSession = true;
  try {
    const intake = createDocumentIntakeRuntime({
      tabManager: manager,
      initialFilterSettings: getInitialFilterSettings(),
      initialViewMode: getInitialViewMode(),
      canonicalizeDocumentPaths: async (paths) => {
        if (!readerActions) throw new Error('Reader Actions are unavailable during restoration');
        const outcome = await readerActions.canonicalizeDocumentPaths(paths);
        if (outcome.status === 'failure') throw outcome.error;
      },
    });
    const result = await restoreReadingSessionAtStartup({
      intake,
      session,
      explicitRequests: payloads.map(({ files, page }) => ({
        paths: files,
        ...(page !== null && page > 0 ? { page } : {}),
      })),
      onForegroundReady: async () => {
        showViewer();
        updateTabBarVisibility(tabManager);
        await updatePrintMenuState(tabManager);
        await applyWindowAfterOpen();
        const currentWindow = getCurrentWebviewWindow();
        await currentWindow.show();
        await currentWindow.setFocus();
      },
      pruneDocument: async (filePath) => {
        const outcome = await readerActions?.dispatch({ type: 'removeDocument', filePath });
        if (outcome?.status === 'failure') throw outcome.error;
      },
      reportFailure: (message) => showToast(message, 'error'),
    });
    reportDocumentIntakeOutcomes(result.explicitRequestResult);
    updateTabBarVisibility(tabManager);
    await updatePrintMenuState(tabManager);

    return manager.size;
  } finally {
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
    recentDocumentAuthority = await loadRecentDocuments(
      createRecentDocumentStorage(settingsManager),
      {
        onPersistenceError: (error) => {
          console.error('Recent Documents persistence failed:', error);
          showToast('Recent Documents could not be saved. Monight will retry.', 'error');
        },
        onChanged: renderRecentFiles,
      },
    );
    renderRecentFiles(recentDocumentAuthority.snapshot());
    annotationAuthority = await loadAnnotations(createAnnotationStorage(settingsManager), {
      onPersistenceError: (error) => {
        console.error('Annotation persistence failed:', error);
        showToast('Annotation changes could not be saved. Monight will retry.', 'error');
      },
      onChanged: (filePath) => {
        for (const tab of tabManager?.getTabs() ?? []) {
          if (filePath !== null && tab.filePath !== filePath) continue;
          tabManager
            ?.getRenderingForTab(tab.id)
            ?.setAnnotations(annotationAuthority?.snapshot(tab.filePath) ?? []);
        }
        sidebarController?.annotationsChanged();
      },
    });
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
    if (!settings.general.restorePreviousSession) {
      restoredReadingSession = EMPTY_READING_SESSION;
    }
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
        ...(annotationAuthority ? { annotationAuthority } : {}),
        onDocumentPrepared: async (tab, runtime) => {
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
            runtime,
          });
          if (outcome?.status === 'failure') throw outcome.error;
        },
        onDocumentOpened: (tab) => rememberRecentDocument(tab.filePath, tab.title),
        onDocumentClosed: async (filePath) => {
          await readerActions?.dispatch({ type: 'removeDocument', filePath });
        },
        onDocumentCloseRequested: async (filePath) => {
          if (!readerActions) throw new Error('Reader Actions are unavailable');
          const outcome = await readerActions.dispatch({ type: 'closeDocument', filePath });
          if (outcome.status === 'failure') throw outcome.error;
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
        resolveLinkTarget: resolveDocumentLinkTarget,
        onDocumentLinkTargetActivated: async (filePath, target) => {
          await dispatchReaderAction({ type: 'activateDocumentTarget', filePath, target });
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
        exitPresentation: async (options) => {
          await presentationController?.exit(options);
        },
        activateDocument: async (filePath, position, visualState) => {
          await tabManager?.projectActiveDocument(filePath, position, visualState);
        },
        closeDocument: async (filePath, nextActiveDocumentPath) => {
          await tabManager?.projectDocumentClose(filePath, nextActiveDocumentPath);
        },
        goToReadingPosition: async (filePath, position, options) => {
          await getDocumentViewer(filePath).goToReadingPosition(position, options);
        },
        getPageCount: (filePath) => {
          const tab = tabManager?.getTabs().find((item) => item.filePath === filePath);
          return tab ? (tabManager?.getRenderingForTab(tab.id)?.getState().totalPages ?? 0) : 0;
        },
        applyZoomIntent: async (filePath, zoomIntent, options) => {
          const viewer = getDocumentViewer(filePath);
          await viewer.setZoomIntent(zoomIntent, options);
          return viewer.getState().zoomIntent;
        },
        applyRelativeZoom: async (filePath, direction, options) => {
          const viewer = getDocumentViewer(filePath);
          await (direction === 'in' ? viewer.zoomIn(options) : viewer.zoomOut(options));
          return viewer.getState().zoomIntent;
        },
        applyRotation: async (filePath, rotation, options) => {
          await getDocumentViewer(filePath).setRotation(rotation, options);
        },
        applyViewMode: async (filePath, viewMode, options) => {
          await getDocumentViewer(filePath).setViewMode(viewMode, options);
        },
        applyFilterSettings: async (filePath, filterSettings, options) => {
          getDocumentViewer(filePath).applyFilter(buildFilterCSS(filterSettings), options);
        },
      },
      externalLinkAdapter: {
        open: async (url) => {
          await invoke('open_external_url', { url });
        },
      },
      printAdapter: browserPrintAdapter,
      reopenDocument: async (filePath) => {
        if (!tabManager) throw new Error('Document Intake is unavailable');
        await openFiles([filePath], {
          tabManager,
          initialFilterSettings: getInitialFilterSettings(),
          initialViewMode: getInitialViewMode(),
        });
        showViewer();
        await refreshAfterOpen();
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
        applyProjectedDocumentStateToTab(tab, document);
      }
      tabManager?.setDocumentOrder(snapshot.documents.map((document) => document.filePath));
      updateUI(tabManager);
    });
    tabManager.setActivationRequester(async (filePath, readingPosition) => {
      const outcome = await readerActions?.dispatch({
        type: 'activateDocument',
        filePath,
        ...(readingPosition ? { readingPosition } : {}),
      });
      if (outcome?.status === 'failure') throw outcome.error;
    });

    searchController = new SearchController(getActiveDocumentAccess);
    sidebarController = new SidebarController({
      getActiveDocument: getActiveDocumentAccess,
      requestAnnotationNote,
      openExternalUrl: async (url) => {
        const filePath = readerActions?.snapshot().activeDocumentPath;
        if (!filePath) return;
        await dispatchReaderAction({
          type: 'activateDocumentTarget',
          filePath,
          target: { url },
        });
      },
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
      openSettings,
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
      handleStartupExternalOpenPayloads: async (payloads) => {
        await restoreStartupReadingSession(payloads);
      },
      reloadSettings: async () => {
        if (!settingsManager) return;
        const updated = await settingsManager.load();
        if (isMac && updated.keybinds.Settings) {
          updated.keybinds.Settings.binds = ['Cmd+,'];
        }
        currentSettings = updated;
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
      clearReadingHistory: async () => {
        if (!settingsManager) return;
        await settingsManager.clearPersistedReadingSession();
        restoredReadingSession = {
          schemaVersion: 2,
          activeDocumentPath: null,
          documents: [],
        };
        recentDocumentAuthority?.clear();
        await recentDocumentAuthority?.flush();
        annotationAuthority?.clear();
        await annotationAuthority?.flush();
      },
      applyWindowAfterOpen,
      updateTabBarVisibility: updateTabBar,
      updatePrintMenuState: () => updatePrintMenuState(tabManager),
      dispatchReaderAction,
      completeApplicationQuit: async () => {
        await finishPendingReaderState(flushReaderState, chooseAfterFinalSaveFailure);
        await invoke('complete_application_quit');
      },
    });

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
        await flushReaderState();
      },
      chooseAfterFinalSaveFailure,
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
