import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  requestAnnotationNote,
  requestConfirmation,
  requestPdfPassword,
  requestPdfSaveFailure,
  requestRecoveryDraft,
  requestUnsavedDocument,
  showToast,
} from './app/dialogs';
import type { DocumentSurfaceProvider } from './app/document-surface-gate';
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
  type ApplicationShutdownCoordinator,
  createApplicationShutdownCoordinator,
  type FinalSaveFailureChoice,
  registerApplicationShutdownHandlers,
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
  pdfSaveAdapter?: import('./reader/native-pdf-editing').NativePdfSaveAdapter;
  recoveryDraftAdapter?: import('./reader/recovery-drafts').RecoveryDraftAdapter;
  createAnnotationStorage: typeof import('./app/annotation-storage').createAnnotationStorage;
  browserPrintAdapter: typeof import('./app/browser-print-adapter').browserPrintAdapter;
  externalLinkAdapter: import('./reader/reader-actions').ExternalLinkAdapter;
  createDocumentIntakeRuntime: typeof import('./app/document-intake-runtime').createDocumentIntakeRuntime;
  createDocumentWorkspace: typeof import('./app/document-workspace').createDocumentWorkspace;
  createDocumentSurface?: DocumentSurfaceProvider;
  createReadingSessionStorage: typeof import('./app/reading-session-storage').createReadingSessionStorage;
  createRecentDocumentStorage: typeof import('./app/recent-document-storage').createRecentDocumentStorage;
  createReaderActions: typeof import('./reader/reader-actions').createReaderActions;
}

let documentWorkspace: DocumentWorkspace | null = null;
let documentIntake: DocumentIntake | null = null;
let startupDocumentIntake: DocumentIntake | null = null;
let applicationShutdown: ApplicationShutdownCoordinator | null = null;

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

const acceptsReaderWork = (): boolean => !applicationShutdown?.isShutdownRequested();

const dispatchReaderActionOutcome = async (action: ReaderAction, options?: ReaderActionOptions) => {
  const actions = readerActions;
  if (!actions) {
    return {
      status: 'failure' as const,
      error: new Error('Reader Actions are unavailable'),
      revision: 0,
    };
  }
  if (!acceptsReaderWork()) {
    return { status: 'no-op' as const, revision: actions.snapshot().revision };
  }
  const saving = action.type === 'saveDocument' || action.type === 'saveDocumentAs';
  const query = saving ? actions.query(action.filePath) : null;
  const outcome = await actions.dispatch(action, options);
  if (saving && query?.isCurrent() && outcome.status === 'failure') {
    const title =
      actions.snapshot().documents.find((item) => item.filePath === query.filePath)?.title ?? 'PDF';
    const choice = await requestPdfSaveFailure(
      title,
      String(outcome.error),
      () => acceptsReaderWork() && query.isCurrent() && !options?.isCancelled?.(),
    );
    if (!query.isCurrent() || options?.isCancelled?.())
      return { status: 'superseded' as const, revision: actions.snapshot().revision };
    if (choice !== 'cancel') {
      const recovery = await actions.dispatch(
        {
          type: choice === 'reload' ? 'discardAndReloadDocument' : 'saveDocumentAs',
          filePath: query.filePath,
        },
        options,
      );
      if (recovery.status === 'failure') showToast(String(recovery.error), 'error');
      return recovery;
    }
    return { status: 'no-op' as const, revision: actions.snapshot().revision };
  }
  return outcome;
};

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

const getActivePresentation = () => documentWorkspace?.activePresentation() ?? null;

const getActiveDocumentAccess = () => {
  const query = readerActions?.query();
  const access = documentWorkspace?.access(query ?? null);
  return access
    ? { ...access, navigateToPage: (pageNumber: number) => goToPage(pageNumber) }
    : null;
};

const goToPage = async (page: number, options?: ReaderActionOptions): Promise<void> => {
  const outcome = await dispatchReaderActionOutcome({ type: 'goToPage', page }, options);
  if (outcome?.status === 'failure') throw outcome.error;
};

const goToRelativePage = async (direction: 'next' | 'previous'): Promise<void> => {
  const outcome = await dispatchReaderActionOutcome({
    type: direction === 'next' ? 'goToNextPage' : 'goToPreviousPage',
  });
  if (outcome?.status === 'failure') throw outcome.error;
};

const dispatchReaderAction = async (action: ReaderAction): Promise<void> => {
  const outcome = await dispatchReaderActionOutcome(action);
  if (outcome?.status === 'failure') {
    if (action.type === 'saveDocument' || action.type === 'saveDocumentAs') {
      showToast(String(outcome.error), 'error');
      return;
    }
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
  if (!acceptsReaderWork()) return;
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
    Boolean(readingSessionStorage && currentSettings?.general.restorePreviousSession),
});

const chooseAfterFinalSaveFailure = async (): Promise<FinalSaveFailureChoice> =>
  (await requestConfirmation({
    title: 'Changes not saved',
    message: 'Monight could not save the latest Reading Session, Recent Documents, or Annotations.',
    confirmLabel: 'Retry save',
    cancelLabel: 'Quit without saving',
    dismissible: false,
  }))
    ? 'retry'
    : 'discard';

const restoreStartupReadingSession = async (
  payloads: readonly ExternalOpenPayload[],
): Promise<number> => {
  if (!startupDocumentIntake) return 0;
  const session = currentSettings?.general.restorePreviousSession
    ? (restoredReadingSession ?? EMPTY_READING_SESSION)
    : EMPTY_READING_SESSION;
  if (session.documents.length === 0 && payloads.length === 0) return 0;

  const result = await restoreReadingSessionAtStartup({
    intake: startupDocumentIntake,
    session,
    explicitRequests: payloads.map(({ files, page }) => ({
      paths: files,
      ...(page !== null && page > 0 ? { page } : {}),
    })),
    onForegroundReady: async () => {
      if (applicationShutdown?.isShutdownRequested()) return;
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
};

export async function initializeApplication(modules: ApplicationModules): Promise<void> {
  const currentWindow = getCurrentWebviewWindow();
  const shutdown = createApplicationShutdownCoordinator({
    prepareShutdown: async () => {
      await documentIntake?.quiesce();
      if (readerActions?.hasUnsavedPdfWork()) {
        showViewer();
        await currentWindow.show();
        await currentWindow.setFocus();
      }
      return (await readerActions?.prepareShutdown()) ?? true;
    },
    canShutdown: () => readerActions?.isShutdownPrepared() ?? true,
    flush: async () => {
      await documentIntake?.quiesce();
      await persistence.flush();
    },
    chooseAfterFailure: chooseAfterFinalSaveFailure,
    closeMainWindow: () => currentWindow.destroy(),
    quitApplication: async () => {
      await invoke('complete_application_quit');
    },
    onShutdownCancelled: () => {
      readerActions?.cancelShutdown();
      documentIntake?.resumeAccepting();
      const container = document.getElementById('pdf-container');
      if (container) container.inert = false;
    },
    onShutdownStarted: () => {
      const container = document.getElementById('pdf-container');
      if (container) container.inert = true;
      documentIntake?.interruptRestoration();
      documentIntake?.stopAccepting();
      if (lastFilterSaveTimer !== null) {
        clearTimeout(lastFilterSaveTimer);
        lastFilterSaveTimer = null;
      }
    },
  });
  applicationShutdown = shutdown;

  try {
    await registerApplicationShutdownHandlers({
      mainWindow: currentWindow,
      listen,
      takePendingApplicationQuit: () => invoke<boolean>('take_application_quit_request'),
      coordinator: shutdown,
    });
    await invoke('complete_frontend_lifecycle_registration');
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
    annotationAuthority = modules.createDocumentSurface
      ? null
      : await loadAnnotations(modules.createAnnotationStorage(settingsManager), {
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
    const createSurface = modules.createDocumentSurface?.({ requestPassword: requestPdfPassword });
    documentWorkspace = modules.createDocumentWorkspace({
      dispatchReaderAction: dispatchReaderActionOutcome,
      dispatchAcceptedIntakeAction: async (action, options) => {
        if (!readerActions) throw new Error('Reader Actions are unavailable');
        return readerActions.dispatch(action, options);
      },
      acceptsReaderActions: acceptsReaderWork,
      captureRecoveryDraft: async (filePath) =>
        (await readerActions?.captureRecoveryDraft(filePath)) ?? {
          status: 'no-op',
          revision: 0,
        },
      snapshot: () => readerActions?.snapshot() ?? { ...initialReadingSession, revision: 0 },
      isDocumentOpen: (filePath) => readerActions?.isDocumentOpen(filePath) ?? false,
      defaultVisualState,
      ...(createSurface ? { createSurface } : {}),
      pdfSaveAdapter: modules.pdfSaveAdapter,
      recoveryDraftAdapter: modules.recoveryDraftAdapter,
      chooseRecoveryDraft: requestRecoveryDraft,
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
        exitPresentation: async (options) =>
          (await presentationController?.exit(options)) ?? undefined,
      },
      externalLinkAdapter: modules.externalLinkAdapter,
      printAdapter: modules.browserPrintAdapter,
      pdfSaveAdapter: modules.pdfSaveAdapter,
      recoveryDraftAdapter: modules.recoveryDraftAdapter,
      chooseUnsavedDocument: requestUnsavedDocument,
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
    startupDocumentIntake = modules.createDocumentIntakeRuntime({
      runtime: documentWorkspace.intakeRuntime,
      canonicalizeDocumentPaths: async (paths) => {
        if (!readerActions) throw new Error('Reader Actions are unavailable');
        const outcome = await readerActions.canonicalizeDocumentPaths(paths);
        if (outcome.status === 'failure') throw outcome.error;
      },
    });
    documentIntake = startupDocumentIntake;
    if (shutdown.isShutdownRequested()) {
      documentIntake.interruptRestoration();
      documentIntake.stopAccepting();
    }
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
    if (modules.pdfSaveAdapter) {
      document.addEventListener(
        'keydown',
        (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            event.stopImmediatePropagation();
            void dispatchReaderAction({ type: event.shiftKey ? 'saveDocumentAs' : 'saveDocument' });
          }
        },
        true,
      );
      window.addEventListener('beforeunload', (event) => {
        if (readerActions?.hasUnsavedPdfWork() && !readerActions.isShutdownPrepared()) {
          event.preventDefault();
          event.returnValue = '';
        }
      });
    }

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
        await dispatchReaderActionOutcome({ type: 'activateDocument', filePath });
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
        if (!settingsManager || !acceptsReaderWork()) return;
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
    });

    shutdown.markReady();
    if (shutdown.isShutdownRequested()) {
      await shutdown.completion();
      if (shutdown.isShutdownRequested()) return;
    }

    // Show the correct initial surface after session/CLI restore has run.
    if ((readerActions?.snapshot().documents.length ?? 0) > 0) {
      showViewer();
    } else {
      showSplash();
    }

    // Show window after initialization
    if (!shutdown.isShutdownRequested()) await currentWindow.show();
    if (!shutdown.isShutdownRequested()) await currentWindow.setFocus();

    debugLog(`${info.name} initialized successfully!`);
  } catch (error) {
    shutdown.markReady();
    console.error('Initialization error:', error);
  }
}
