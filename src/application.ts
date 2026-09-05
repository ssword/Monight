import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  requestAnnotationNote,
  requestConfirmation,
  requestPdfPassword,
  showToast,
} from './app/dialogs';
import type { DocumentWorkspace } from './app/document-workspace';
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
import { createPersistenceCoordinator } from './app/persistence-coordinator';
import { PresentationController } from './app/presentation-controller';
import { SearchController } from './app/search-controller';
import { SidebarController } from './app/sidebar-controller';
import { restoreReadingSessionAtStartup } from './app/startup-restoration';
import { type ExternalOpenPayload, setupTauriListeners } from './app/tauri-events';
import {
  renderRecentFiles,
  showSplash,
  showViewer,
  updateActivePresetButton,
  updateKeyboardHints,
  updateTabBarVisibility,
  updateUI,
} from './app/ui';
import {
  type FinalSaveFailureChoice,
  finishPendingPersistence,
  registerReadingSessionCloseGuard,
} from './app/window-lifecycle';
import { debugLog } from './lib/debug-log';
import type { ViewMode } from './lib/document-features';
import type { PdfLinkTarget } from './lib/pdf-links';
import { type AnnotationAuthority, loadAnnotations } from './reader/annotations';
import type { DocumentIntake } from './reader/document-intake';
import {
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
import { type FilterSettings, PRESETS } from './scripts/filters';
import { KeybindManager } from './scripts/keybind-manager';
import { type MoonightSettings, SettingsManager } from './scripts/settings';
import { SliderManager } from './scripts/sliders';

interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
}

export interface ApplicationModules {
  createAnnotationStorage: typeof import('./app/annotation-storage').createAnnotationStorage;
  browserPrintAdapter: typeof import('./app/browser-print-adapter').browserPrintAdapter;
  externalLinkAdapter: import('./reader/reader-actions').ExternalLinkAdapter;
  createDocumentIntakeRuntime: typeof import('./app/document-intake-runtime').createDocumentIntakeRuntime;
  createDocumentWorkspace: typeof import('./app/document-workspace').createDocumentWorkspace;
  createReadingSessionStorage: typeof import('./app/reading-session-storage').createReadingSessionStorage;
  createRecentDocumentStorage: typeof import('./app/recent-document-storage').createRecentDocumentStorage;
  createReaderActions: typeof import('./reader/reader-actions').createReaderActions;
}

let documentWorkspace: DocumentWorkspace | null = null;
let documentIntake: DocumentIntake | null = null;

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
  const hasDocument = (readerActions?.snapshot().documents.length ?? 0) > 0;
  updateTabBarVisibility(hasDocument);
  await updatePrintMenuState(hasDocument);
  await applyWindowAfterOpen();
};

const openPdfAndRefresh = async (): Promise<void> => {
  const opened = await openPDFFile(documentIntake);
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

const getActivePresentation = () => documentWorkspace?.activePresentation() ?? null;

const getActiveDocumentAccess = () => {
  const query = readerActions?.query();
  const access = documentWorkspace?.access(query ?? null);
  return access
    ? { ...access, navigateToPage: (pageNumber: number) => goToPage(pageNumber) }
    : null;
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
  if (!documentIntake) return;
  try {
    await openFiles([filePath], {
      intake: documentIntake,
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

const persistence = createPersistenceCoordinator({
  readerActions: () => readerActions,
  annotations: () => annotationAuthority,
  recentDocuments: () => recentDocumentAuthority,
  activeReadingPosition: () => documentWorkspace?.activeReadingPosition() ?? null,
  shouldPersistReadingSession: () =>
    Boolean(
      readingSessionStorage &&
        currentSettings?.general.restorePreviousSession &&
        !isRestoringSession,
    ),
});

const chooseAfterFinalSaveFailure = async (): Promise<FinalSaveFailureChoice> =>
  (await requestConfirmation({
    title: 'Changes not saved',
    message: 'Monight could not save the latest Reading Session, Recent Documents, or Annotations.',
    confirmLabel: 'Retry save',
    cancelLabel: 'Quit without saving',
  }))
    ? 'retry'
    : 'discard';

const restoreStartupReadingSession = async (
  payloads: readonly ExternalOpenPayload[],
): Promise<number> => {
  if (!documentIntake) return 0;
  const session = currentSettings?.general.restorePreviousSession
    ? (restoredReadingSession ?? EMPTY_READING_SESSION)
    : EMPTY_READING_SESSION;
  if (session.documents.length === 0 && payloads.length === 0) return 0;

  isRestoringSession = true;
  try {
    const result = await restoreReadingSessionAtStartup({
      intake: documentIntake,
      session,
      explicitRequests: payloads.map(({ files, page }) => ({
        paths: files,
        ...(page !== null && page > 0 ? { page } : {}),
      })),
      onForegroundReady: async () => {
        showViewer();
        const hasDocument = (readerActions?.snapshot().documents.length ?? 0) > 0;
        updateTabBarVisibility(hasDocument);
        await updatePrintMenuState(hasDocument);
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
    const hasDocument = (readerActions?.snapshot().documents.length ?? 0) > 0;
    updateTabBarVisibility(hasDocument);
    await updatePrintMenuState(hasDocument);

    return readerActions?.snapshot().documents.length ?? 0;
  } finally {
    isRestoringSession = false;
  }
};

export async function initializeApplication(modules: ApplicationModules): Promise<void> {
  try {
    debugLog('Initializing app...');

    // Initialize settings manager
    settingsManager = new SettingsManager();
    const settings = await settingsManager.load();
    currentSettings = settings;
    recentDocumentAuthority = await loadRecentDocuments(
      modules.createRecentDocumentStorage(settingsManager),
      {
        onPersistenceError: (error) => {
          console.error('Recent Documents persistence failed:', error);
          showToast('Recent Documents could not be saved. Monight will retry.', 'error');
        },
        onChanged: renderRecentFiles,
      },
    );
    renderRecentFiles(recentDocumentAuthority.snapshot());
    annotationAuthority = await loadAnnotations(modules.createAnnotationStorage(settingsManager), {
      onPersistenceError: (error) => {
        console.error('Annotation persistence failed:', error);
        showToast('Annotation changes could not be saved. Monight will retry.', 'error');
      },
      onChanged: (filePath) => {
        documentWorkspace?.replaceAnnotations(filePath);
        sidebarController?.annotationsChanged();
      },
    });
    readingSessionStorage = modules.createReadingSessionStorage(settingsManager);
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

    const defaultVisualState = () => ({
      filterSettings: getInitialFilterSettings(),
      zoomIntent: { kind: 'manual' as const, scale: 1 },
      rotation: 0,
      viewMode: getInitialViewMode(),
    });
    const initialReadingSession = restoredReadingSession ?? EMPTY_READING_SESSION;
    documentWorkspace = modules.createDocumentWorkspace({
      dispatch: async (action) => {
        if (!readerActions) throw new Error('Reader Actions are unavailable');
        return readerActions.dispatch(action);
      },
      snapshot: () => readerActions?.snapshot() ?? { ...initialReadingSession, revision: 0 },
      defaultVisualState,
      ...(annotationAuthority ? { annotationAuthority } : {}),
      requestPassword: requestPdfPassword,
      requestAnnotationNote,
      reportError: (message) => showToast(message, 'error'),
      resolveLinkTarget: resolveDocumentLinkTarget,
      activateLinkTarget: async (filePath, target) => {
        await dispatchReaderAction({ type: 'activateDocumentTarget', filePath, target });
      },
      documentOpened: rememberRecentDocument,
      activeDocumentChanged: async () => {
        showViewer();
      },
      renderingStateChanged: () => {
        if (!readerActions || !documentWorkspace) return;
        updateUI(readerActions.snapshot(), documentWorkspace.activeRenderingState());
        sidebarController?.presentationStateChanged();
      },
    });

    readerActions = modules.createReaderActions({
      initialSession: initialReadingSession,
      defaultVisualState: defaultVisualState(),
      projection: {
        ...documentWorkspace.projection,
        exitPresentation: async (options) => {
          await presentationController?.exit(options);
        },
      },
      externalLinkAdapter: modules.externalLinkAdapter,
      printAdapter: modules.browserPrintAdapter,
      reopenDocument: async (filePath) => {
        if (!documentIntake) throw new Error('Document Intake is unavailable');
        await openFiles([filePath], {
          intake: documentIntake,
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
    documentIntake = modules.createDocumentIntakeRuntime({
      runtime: documentWorkspace.intakeRuntime,
      canonicalizeDocumentPaths: async (paths) => {
        if (!readerActions) throw new Error('Reader Actions are unavailable');
        const outcome = await readerActions.canonicalizeDocumentPaths(paths);
        if (outcome.status === 'failure') throw outcome.error;
      },
    });
    let observedActiveDocumentPath = readerActions.snapshot().activeDocumentPath;
    readerActions.observe((snapshot) => {
      documentWorkspace?.project(snapshot);
      updateUI(snapshot, documentWorkspace?.activeRenderingState() ?? null);
      const activeDocument = snapshot.documents.find(
        ({ filePath }) => filePath === snapshot.activeDocumentPath,
      );
      if (activeDocument?.visualState) {
        sliderManager?.setPreset(activeDocument.visualState.filterSettings);
        updateActivePresetButton(activeDocument.visualState.filterSettings);
      }
      if (snapshot.activeDocumentPath !== observedActiveDocumentPath) {
        observedActiveDocumentPath = snapshot.activeDocumentPath;
        searchController?.activeDocumentChanged();
        sidebarController?.activeDocumentChanged();
      }
      const hasDocument = snapshot.documents.length > 0;
      updateTabBarVisibility(hasDocument);
      void updatePrintMenuState(hasDocument);
    });
    documentWorkspace.project(readerActions.snapshot());

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
      getActivePresentation,
      onStateChanged: (active) => {
        if (readerActions && documentWorkspace) {
          updateUI(readerActions.snapshot(), documentWorkspace.activeRenderingState());
        }
        if (!active) sidebarController?.presentationStateChanged();
      },
    });

    // Initialize slider manager
    sliderManager = new SliderManager((filterSettings) => {
      void dispatchReaderAction(readerAction.setFilterSettings(filterSettings));
    });

    // Initialize keybind manager
    keybindManager = new KeybindManager(isMac);

    const updateReaderUI = () => {
      if (readerActions && documentWorkspace) {
        updateUI(readerActions.snapshot(), documentWorkspace.activeRenderingState());
      }
    };
    const updateTabBar = () =>
      updateTabBarVisibility((readerActions?.snapshot().documents.length ?? 0) > 0);

    // Register all action handlers
    registerKeybindActions({
      keybindManager,
      getReadingSessionSnapshot: () => {
        if (!readerActions) throw new Error('Reader Actions are unavailable');
        return readerActions.snapshot();
      },
      getActivePageCount: async () => (await readerActions?.query()?.metadata())?.pageCount ?? 0,
      openPdfAndRefresh,
      openSettings,
      updateTabBarVisibility: updateTabBar,
      updateUI: updateReaderUI,
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
      sliderManager,
      keybindManager,
      openPdfAndRefresh,
      updateUI: updateReaderUI,
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
      intake: documentIntake,
      getActiveDocumentPath: () => readerActions?.snapshot().activeDocumentPath ?? null,
      settingsManager,
      keybindManager,
      isMac,
      openPdfAndRefresh,
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
      updatePrintMenuState: () =>
        updatePrintMenuState((readerActions?.snapshot().documents.length ?? 0) > 0),
      dispatchReaderAction,
      completeApplicationQuit: async () => {
        await finishPendingPersistence(() => persistence.flush(), chooseAfterFinalSaveFailure);
        await invoke('complete_application_quit');
      },
    });

    // Show the correct initial surface after session/CLI restore has run.
    if ((readerActions?.snapshot().documents.length ?? 0) > 0) {
      showViewer();
    } else {
      showSplash();
    }

    // Get current window
    const currentWindow = getCurrentWebviewWindow();

    await registerReadingSessionCloseGuard(
      currentWindow,
      async () => {
        await persistence.flush();
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
