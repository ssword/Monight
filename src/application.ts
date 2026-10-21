import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { hydrateChromeIcons } from './app/chrome-icons';
import {
  type ChromePreferencesAuthority,
  type ChromePreferencesStorage,
  DEFAULT_CHROME_PREFERENCES,
  loadChromePreferences,
} from './app/chrome-preferences';
import {
  requestConfirmation,
  requestPageNumber,
  requestPdfPassword,
  requestPdfSaveFailure,
  requestRecoveryDraft,
  requestUnsavedDocument,
  showToast,
} from './app/dialogs';
import type { DocumentSurfaceProvider, DocumentWorkspace } from './app/document-workspace';
import { type ReaderChromeControls, setupEventListeners } from './app/dom-events';
import {
  ensureMinimumViewingSize,
  openFiles,
  openPDFFile,
  openSettings,
  reportDocumentIntakeOutcomes,
  updatePrintMenuState,
} from './app/file-actions';
import { createHighlightButton, type HighlightButton } from './app/highlight-button';
import { registerKeybindActions, toggleWindowFullScreen } from './app/keybinds';
import {
  createMarkupToolbar,
  leaveMarkupToolOnEscape,
  type MarkupToolbar,
} from './app/markup-toolbar';
import { createNativeMenuSync, createReaderMenu } from './app/native-menu';
import { createPersistenceCoordinator } from './app/persistence-coordinator';
import { PresentationController } from './app/presentation-controller';
import type { ReaderCommandContext, ReaderCommandStateInput } from './app/reader-commands';
import { createReaderSidebar, type ReaderSidebar } from './app/reader-sidebar';
import { createRotateButton, type RotateButton } from './app/rotate-button';
import { restoreReadingSessionAtStartup } from './app/startup-restoration';
import { type ExternalOpenPayload, setupTauriListeners } from './app/tauri-events';
import {
  applyWindowChrome,
  renderRecentFiles,
  showSplash,
  showViewer,
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
import type { DocumentIntake } from './reader/document-intake';
import { DEFAULT_ANNOTATION_DISPLAY_NAME } from './reader/native-pdf-editing';
import {
  type PersistedReadingSession,
  READING_SESSION_SCHEMA_VERSION,
  type ReaderAction,
  type ReaderActionOptions,
  type ReaderActions,
  type ReadingSessionSnapshot,
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
  browserPrintAdapter: typeof import('./app/browser-print-adapter').browserPrintAdapter;
  externalLinkAdapter: import('./reader/reader-actions').ExternalLinkAdapter;
  createDocumentIntakeRuntime: typeof import('./app/document-intake-runtime').createDocumentIntakeRuntime;
  createDocumentWorkspace: typeof import('./app/document-workspace').createDocumentWorkspace;
  createDocumentSurface: DocumentSurfaceProvider;
  createReadingSessionStorage: typeof import('./app/reading-session-storage').createReadingSessionStorage;
  createRecentDocumentStorage: typeof import('./app/recent-document-storage').createRecentDocumentStorage;
  createChromePreferencesStorage?: () => ChromePreferencesStorage;
  createReaderActions: typeof import('./reader/reader-actions').createReaderActions;
}

let documentWorkspace: DocumentWorkspace | null = null;
let documentIntake: DocumentIntake | null = null;
let startupDocumentIntake: DocumentIntake | null = null;
let applicationShutdown: ApplicationShutdownCoordinator | null = null;

// Global slider manager instance
let sliderManager: SliderManager | null = null;
let readerChrome: ReaderChromeControls | null = null;

const showActiveAppearance = (snapshot: ReadingSessionSnapshot): void => {
  const activeDocument = snapshot.documents.find(
    ({ filePath }) => filePath === snapshot.activeDocumentPath,
  );
  if (activeDocument?.visualState) {
    readerChrome?.showAppearance(
      activeDocument.filePath,
      activeDocument.visualState.filterSettings,
    );
  }
};

// Global settings manager instance
let settingsManager: SettingsManager | null = null;
let currentSettings: MoonightSettings | null = null;
let readerActions: ReaderActions | null = null;
let readingSessionStorage: ReadingSessionStorage | null = null;
let restoredReadingSession: PersistedReadingSession | null = null;
let recentDocumentAuthority: RecentDocumentAuthority | null = null;
let chromePreferences: ChromePreferencesAuthority | null = null;
let readerSidebar: ReaderSidebar | null = null;
let markupToolbar: MarkupToolbar | null = null;
let highlightButton: HighlightButton | null = null;
let rotateButton: RotateButton | null = null;

// Global keybind manager instance
let keybindManager: KeybindManager | null = null;
/** The effective keybinds, which the native menu shows as accelerators. */
let activeKeybinds: MoonightSettings['keybinds'] | undefined;
let presentationController: PresentationController | null = null;
let readerCommandContext: ReaderCommandContext | null = null;
let windowFullScreen = false;

/** Shows the tab bar for two or more Documents, or for one after View ▸ Show Tab Bar. */
const showTabBar = (documentCount: number): void =>
  updateTabBarVisibility(documentCount, chromePreferences?.snapshot().tabBarVisible ?? false);

const readerMenuState = (): ReaderCommandStateInput => {
  const snapshot = readerActions?.snapshot();
  const activeDocument = snapshot?.documents.find(
    ({ filePath }) => filePath === snapshot.activeDocumentPath,
  );
  const rendering = documentWorkspace?.activeRenderingState() ?? null;
  const live = rendering && rendering.filePath === activeDocument?.filePath ? rendering : null;
  return {
    documentCount: snapshot?.documents.length ?? 0,
    activeDocument: activeDocument
      ? {
          viewMode: activeDocument.visualState?.viewMode ?? live?.viewMode ?? getInitialViewMode(),
          filterSettings: activeDocument.visualState?.filterSettings ?? getInitialFilterSettings(),
          currentPage: live?.currentPage ?? 0,
          pageCount: live?.totalPages ?? 0,
        }
      : null,
    preferences: chromePreferences?.snapshot() ?? DEFAULT_CHROME_PREFERENCES,
    markup: documentWorkspace?.activeMarkup() ?? null,
    fullScreen: windowFullScreen,
    keybinds: activeKeybinds,
  };
};

// The native View, Go and Tools menus (reader-commands.ts).
const readerMenu = createReaderMenu({
  nativeMenu: createNativeMenuSync((command, args) => invoke(command, args)),
  stateInput: readerMenuState,
  context: () => readerCommandContext,
});
const syncReaderMenu = (): void => {
  void readerMenu.sync();
};

const refreshWindowFullScreen = async (): Promise<void> => {
  try {
    windowFullScreen = await getCurrentWebviewWindow().isFullscreen();
  } catch (error) {
    console.error('Failed to read the full screen state:', error);
  }
  syncReaderMenu();
};

// Detect if we're on macOS
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

/** Loads the effective keybinds into the shortcuts and the native menu accelerators. */
const applyKeybinds = (settings: MoonightSettings): void => {
  // Override Settings keybind for macOS with Cmd+,
  if (isMac && settings.keybinds.Settings) {
    settings.keybinds.Settings.binds = ['Cmd+,'];
  }
  keybindManager?.loadFromSettings(settings);
  activeKeybinds = settings.keybinds;
  syncReaderMenu();
};

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
  const documentCount = readerActions?.snapshot().documents.length ?? 0;
  const hasDocument = documentCount > 0;
  showTabBar(documentCount);
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
  recentDocuments: () => recentDocumentAuthority,
  activeReadingPosition: () => documentWorkspace?.activeReadingPosition() ?? null,
  shouldPersistReadingSession: () =>
    Boolean(readingSessionStorage && currentSettings?.general.restorePreviousSession),
});

const chooseAfterFinalSaveFailure = async (): Promise<FinalSaveFailureChoice> =>
  (await requestConfirmation({
    title: 'Changes not saved',
    message: 'Monight could not save the latest Reading Session or Recent Documents.',
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
      const documentCount = readerActions?.snapshot().documents.length ?? 0;
      const hasDocument = documentCount > 0;
      showTabBar(documentCount);
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
  const documentCount = readerActions?.snapshot().documents.length ?? 0;
  const hasDocument = documentCount > 0;
  showTabBar(documentCount);
  await updatePrintMenuState(hasDocument);

  return readerActions?.snapshot().documents.length ?? 0;
};

function createTransientChromePreferencesStorage(): ChromePreferencesStorage {
  let stored: unknown;
  return {
    read: async () => stored,
    write: async (preferences) => {
      stored = preferences;
    },
  };
}

function mountReaderSidebar(
  preferences: ChromePreferencesAuthority,
  defaultVisualState: () => { filterSettings: FilterSettings },
): ReaderSidebar | null {
  const root = document.getElementById('reader-sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const modeToggle = document.getElementById('sidebar-mode-toggle');
  const modeMenu = document.getElementById('sidebar-mode-menu');
  const search = document.getElementById('toolbar-search');
  if (
    !root ||
    !(toggle instanceof HTMLButtonElement) ||
    !(modeToggle instanceof HTMLButtonElement) ||
    !modeMenu
  ) {
    return null;
  }
  const sidebar = createReaderSidebar({
    elements: {
      root,
      toggle,
      modeToggle,
      modeMenu,
      ...(search instanceof HTMLInputElement ? { search } : {}),
    },
    preferences,
    dispatchReaderAction,
    revealAnnotation: (filePath, annotationId) =>
      documentWorkspace?.revealAnnotation(filePath, annotationId),
    activeDocument: () => {
      const snapshot = readerActions?.snapshot();
      const rendering = documentWorkspace?.activeRenderingState();
      const filePath = snapshot?.activeDocumentPath;
      if (!snapshot || !filePath || !rendering || rendering.filePath !== filePath) return null;
      const visualState = snapshot.documents.find(
        (document) => document.filePath === filePath,
      )?.visualState;
      return {
        filePath,
        pageCount: rendering.totalPages,
        currentPage: rendering.currentPage,
        filterSettings: visualState?.filterSettings ?? defaultVisualState().filterSettings,
        query: readerActions?.query(filePath) ?? null,
      };
    },
  });
  sidebar.refresh();
  return sidebar;
}

function mountHighlightButton(preferences: ChromePreferencesAuthority): HighlightButton | null {
  const button = document.getElementById('highlight-button');
  const menuToggle = document.getElementById('highlight-menu-toggle');
  const menu = document.getElementById('highlight-menu');
  if (!(button instanceof HTMLButtonElement) || !(menuToggle instanceof HTMLButtonElement) || !menu)
    return null;
  return createHighlightButton({
    elements: { button, menuToggle, menu },
    preferences,
    activeMarkup: () => documentWorkspace?.activeMarkup() ?? null,
    setActiveTool: (toolId, defaults) =>
      documentWorkspace?.setActiveAnnotationTool(toolId, defaults),
    markupSelection: (toolId, defaults) =>
      documentWorkspace?.markupSelection(toolId, defaults) ?? false,
  });
}

function mountRotateButton(): RotateButton | null {
  const slot = document.getElementById('rotate-control');
  if (!slot) return null;
  return createRotateButton({
    slot,
    activeMarkup: () => documentWorkspace?.activeMarkup() ?? null,
    runCommand: (id) => readerMenu.run(id),
  });
}

function mountMarkupToolbar(preferences: ChromePreferencesAuthority): MarkupToolbar | null {
  const bar = document.getElementById('markup-toolbar');
  const toggle = document.getElementById('markup-toolbar-toggle');
  if (!bar || !(toggle instanceof HTMLButtonElement)) return null;
  return createMarkupToolbar({
    elements: { bar, toggle },
    preferences,
    activeMarkup: () => documentWorkspace?.activeMarkup() ?? null,
    setActiveTool: (toolId) => documentWorkspace?.setActiveAnnotationTool(toolId),
  });
}

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
      // Chrome preferences are best-effort and never hold up quitting.
      await chromePreferences?.flush().catch(() => undefined);
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
      documentIntake?.interrupt();
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
    chromePreferences = await loadChromePreferences(
      modules.createChromePreferencesStorage?.() ?? createTransientChromePreferencesStorage(),
      {
        onPersistenceError: (error) =>
          console.error('Chrome preferences persistence failed:', error),
      },
    );
    chromePreferences.observe(() => {
      showTabBar(readerActions?.snapshot().documents.length ?? 0);
      syncReaderMenu();
    });
    readingSessionStorage = modules.createReadingSessionStorage(settingsManager);
    try {
      restoredReadingSession = await loadReadingSession(readingSessionStorage);
    } catch (error) {
      console.error('Reading Session migration failed; legacy data was retained:', error);
      restoredReadingSession = {
        schemaVersion: READING_SESSION_SCHEMA_VERSION,
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
      viewMode: getInitialViewMode(),
    });
    const initialReadingSession = restoredReadingSession ?? EMPTY_READING_SESSION;
    const createSurface = modules.createDocumentSurface({
      requestPassword: requestPdfPassword,
      getAnnotationDisplayName: () =>
        currentSettings?.general.annotationDisplayName ?? DEFAULT_ANNOTATION_DISPLAY_NAME,
    });
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
      autosaveDocument: async (filePath) =>
        (await readerActions?.dispatch({ type: 'saveDocument', filePath })) ?? {
          status: 'no-op',
          revision: 0,
        },
      snapshot: () => readerActions?.snapshot() ?? { ...initialReadingSession, revision: 0 },
      isDocumentOpen: (filePath) => readerActions?.isDocumentOpen(filePath) ?? false,
      defaultVisualState,
      createSurface,
      pdfSaveAdapter: modules.pdfSaveAdapter,
      recoveryDraftAdapter: modules.recoveryDraftAdapter,
      chooseRecoveryDraft: requestRecoveryDraft,
      reportError: (message) => showToast(message, 'error'),
      documentOpened: rememberRecentDocument,
      activeDocumentChanged: async () => {
        showViewer();
      },
      renderingStateChanged: () => {
        if (!readerActions || !documentWorkspace) return;
        updateUI(readerActions.snapshot(), documentWorkspace.activeRenderingState());
        readerSidebar?.refresh();
        markupToolbar?.refresh();
        highlightButton?.refresh();
        rotateButton?.refresh();
        syncReaderMenu();
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
      saveEditsOnClose: true,
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
      documentIntake.interrupt();
      documentIntake.stopAccepting();
    }
    readerSidebar = mountReaderSidebar(chromePreferences, defaultVisualState);
    markupToolbar = mountMarkupToolbar(chromePreferences);
    highlightButton = mountHighlightButton(chromePreferences);
    rotateButton = mountRotateButton();
    leaveMarkupToolOnEscape({
      activeMarkup: () => documentWorkspace?.activeMarkup() ?? null,
      setActiveTool: (toolId) => documentWorkspace?.setActiveAnnotationTool(toolId),
      presentationActive: () => presentationController?.isActive() ?? false,
    });
    readerActions.observe((snapshot) => {
      documentWorkspace?.project(snapshot);
      updateUI(snapshot, documentWorkspace?.activeRenderingState() ?? null);
      readerSidebar?.refresh();
      markupToolbar?.refresh();
      highlightButton?.refresh();
      rotateButton?.refresh();
      showActiveAppearance(snapshot);
      const hasDocument = snapshot.documents.length > 0;
      showTabBar(snapshot.documents.length);
      void updatePrintMenuState(hasDocument);
      syncReaderMenu();
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

    presentationController = new PresentationController({
      getActivePresentation,
      onStateChanged: () => {
        if (readerActions && documentWorkspace) {
          updateUI(readerActions.snapshot(), documentWorkspace.activeRenderingState());
        }
        void refreshWindowFullScreen();
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
    const updateTabBar = () => showTabBar(readerActions?.snapshot().documents.length ?? 0);

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
      openSearch: () => readerSidebar?.focusSearch(),
      togglePresentationMode: async () => {
        await presentationController?.toggle();
      },
      goToPage,
      goToRelativePage,
      runReaderCommand: (id) => readerMenu.run(id),
      dispatchReaderAction,
    });

    applyKeybinds(settings);
    debugLog('KeybindManager initialized with settings keybinds');

    // Get app information
    const info = await getAppInfo();

    // Update version display
    const versionElement = document.getElementById('version-info');
    if (versionElement) {
      versionElement.textContent = `v${info.version} • Tauri ${info.tauriVersion}`;
    }

    applyWindowChrome(document, isMac);
    hydrateChromeIcons(document);

    // Setup event listeners
    readerChrome = setupEventListeners({
      sliderManager,
      keybindManager,
      openPdfAndRefresh,
      activateDocument: async (filePath) => {
        await dispatchReaderActionOutcome({ type: 'activateDocument', filePath });
      },
      openRecentFile,
      clearRecentFiles,
      dispatchReaderAction,
    });
    if (readerActions) showActiveAppearance(readerActions.snapshot());

    // Native View, Go and Tools items go through the same toolbar entry points.
    const preferencesForCommands = chromePreferences;
    const chromeForCommands = readerChrome;
    readerCommandContext = {
      dispatchReaderAction,
      preferences: preferencesForCommands,
      sidebar: readerSidebar,
      markupToolbar,
      highlightButton,
      appearance: { choose: (preset) => chromeForCommands.chooseAppearance(preset) },
      setActiveTool: (toolId) => documentWorkspace?.setActiveAnnotationTool(toolId),
      toggleSlideshow: async () => {
        await presentationController?.toggle();
      },
      toggleFullScreen: async () => {
        await toggleWindowFullScreen();
        await refreshWindowFullScreen();
      },
      requestPage: async () => {
        const { activeDocument } = readerMenuState();
        if (!activeDocument || activeDocument.pageCount < 1) return null;
        return requestPageNumber({
          currentPage: Math.max(1, activeDocument.currentPage),
          pageCount: activeDocument.pageCount,
        });
      },
      selectedPages: () => readerSidebar?.selectedPages() ?? [],
      currentPage: () => readerMenuState().activeDocument?.currentPage || null,
    };
    await currentWindow.onResized(() => {
      void refreshWindowFullScreen();
    });
    await readerMenu.install();

    // Update keyboard hints for platform
    updateKeyboardHints(isMac);

    // A visible WebView is required for EmbedPDF to publish layout frames during
    // Reading Session restoration. The splash remains interactive while it runs.
    if (!shutdown.isShutdownRequested()) {
      await currentWindow.show();
      await currentWindow.setFocus();
    }

    // Listen before restoration so an explicit startup Document wins foreground precedence.
    await setupTauriListeners({
      intake: documentIntake,
      getActiveDocumentPath: () => readerActions?.snapshot().activeDocumentPath ?? null,
      reloadKeybinds: async () => {
        if (settingsManager) applyKeybinds(await settingsManager.load());
      },
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
        documentWorkspace?.setAnnotationDisplayName(updated.general.annotationDisplayName);
        if (!updated.general.rememberLastFilter && lastFilterSaveTimer !== null) {
          clearTimeout(lastFilterSaveTimer);
          lastFilterSaveTimer = null;
        }
        if (!updated.general.restorePreviousSession) {
          await settingsManager.clearPersistedReadingSession();
          restoredReadingSession = {
            schemaVersion: READING_SESSION_SCHEMA_VERSION,
            activeDocumentPath: null,
            documents: [],
          };
        }
      },
      clearReadingHistory: async () => {
        if (!settingsManager || !acceptsReaderWork()) return;
        await settingsManager.clearPersistedReadingSession();
        restoredReadingSession = {
          schemaVersion: READING_SESSION_SCHEMA_VERSION,
          activeDocumentPath: null,
          documents: [],
        };
        recentDocumentAuthority?.clear();
        await recentDocumentAuthority?.flush();
      },
      applyWindowAfterOpen,
      updateTabBarVisibility: updateTabBar,
      updatePrintMenuState: () =>
        updatePrintMenuState((readerActions?.snapshot().documents.length ?? 0) > 0),
      dispatchReaderAction,
      runMenuCommand: (id) => readerMenu.run(id),
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
    const message = error instanceof Error ? error.message : String(error);
    showSplash();
    const status = document.getElementById('version-info');
    if (status) {
      status.setAttribute('role', 'alert');
      status.textContent = `Startup failed: ${message}`;
    }
    if (!shutdown.isShutdownRequested()) {
      try {
        await currentWindow.show();
        await currentWindow.setFocus();
      } catch (windowError) {
        console.error('Failed to reveal initialization error:', windowError);
      }
    }
  }
}
