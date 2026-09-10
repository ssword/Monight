// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentWorkspace as createRealDocumentWorkspace,
  type DocumentSurface,
  type DocumentSurfaceFactory,
} from '../app/document-workspace';
import type { ApplicationModules } from '../application';
import {
  createDocumentIntake as createRealDocumentIntake,
  type DocumentIntake,
  type PdfSource,
} from '../reader/document-intake';
import type { DocumentRendering } from '../reader/document-rendering';
import {
  createReaderActions as createRealReaderActions,
  type PersistedReadingSession,
  type ReaderActions,
  type ReadingSessionSnapshot,
} from '../reader/reader-actions';

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const listeners = new Map<string, () => void | Promise<void>>();
  let closeHandler: ((event: { preventDefault: () => void }) => void | Promise<void>) | null = null;
  let auxiliaryCloseHandler:
    | ((event: { preventDefault: () => void }) => void | Promise<void>)
    | null = null;
  let requestAuxiliaryClose: (() => Promise<void>) | null = null;
  let pendingQuit = false;
  let restorePreviousSession = true;
  let annotationDisplayName = 'Guest';
  let confirmationChoices: boolean[] = [];
  let finishRestoration: (() => void) | null = null;
  let restorationBarrier = Promise.resolve();
  let useRealRestoration = false;
  let savedReadingSession: PersistedReadingSession = {
    schemaVersion: 2,
    activeDocumentPath: '/docs/report.pdf',
    documents: [
      {
        filePath: '/docs/report.pdf',
        title: 'report.pdf',
        readingPosition: { page: 3, location: 0.25 },
      },
    ],
  };
  const persistedReadingSessions: ReadingSessionSnapshot[] = [];

  const resetRestoration = () => {
    restorationBarrier = new Promise<void>((resolve) => {
      finishRestoration = resolve;
    });
  };

  return {
    events,
    listeners,
    setPendingQuit(value: boolean) {
      pendingQuit = value;
    },
    takePendingQuit: () => pendingQuit,
    setRestorePreviousSession(value: boolean) {
      restorePreviousSession = value;
    },
    restorePreviousSession: () => restorePreviousSession,
    setAnnotationDisplayName(value: string) {
      annotationDisplayName = value;
    },
    annotationDisplayName: () => annotationDisplayName,
    setUseRealRestoration(value: boolean) {
      useRealRestoration = value;
    },
    useRealRestoration: () => useRealRestoration,
    setSavedReadingSession(session: PersistedReadingSession) {
      savedReadingSession = session;
    },
    savedReadingSession: () => savedReadingSession,
    persistedReadingSessions,
    setConfirmationChoices(choices: boolean[]) {
      confirmationChoices = [...choices];
    },
    takeConfirmationChoice() {
      const choice = confirmationChoices.shift() ?? true;
      events.push(`confirmation:${choice}`);
      return choice;
    },
    setCloseHandler(handler: typeof closeHandler) {
      closeHandler = handler;
    },
    getCloseHandler: () => closeHandler,
    setAuxiliaryCloseHandler(handler: typeof auxiliaryCloseHandler) {
      auxiliaryCloseHandler = handler;
    },
    getAuxiliaryCloseHandler: () => auxiliaryCloseHandler,
    setAuxiliaryCloseRequester(request: () => Promise<void>) {
      requestAuxiliaryClose = request;
    },
    requestAuxiliaryClose: () => requestAuxiliaryClose?.(),
    resetRestoration,
    waitForRestoration: () => restorationBarrier,
    finishRestoration: () => finishRestoration?.(),
    reset() {
      events.length = 0;
      listeners.clear();
      closeHandler = null;
      auxiliaryCloseHandler = null;
      pendingQuit = false;
      restorePreviousSession = true;
      annotationDisplayName = 'Guest';
      confirmationChoices = [];
      useRealRestoration = false;
      savedReadingSession = {
        schemaVersion: 2,
        activeDocumentPath: '/docs/report.pdf',
        documents: [
          {
            filePath: '/docs/report.pdf',
            title: 'report.pdf',
            readingPosition: { page: 3, location: 0.25 },
          },
        ],
      };
      persistedReadingSessions.length = 0;
      resetRestoration();
    },
  };
});

vi.mock('@tauri-apps/api/app', () => ({
  getName: vi.fn(async () => 'Monight'),
  getVersion: vi.fn(async () => '1.0.6'),
  getTauriVersion: vi.fn(async () => '2.11.0'),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    mocks.events.push(`invoke:${command}`);
    if (command === 'take_application_quit_request') return mocks.takePendingQuit();
    if (command === 'take_external_open_payloads') return [];
    return undefined;
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: () => void | Promise<void>) => {
    mocks.events.push(`listen:${event}`);
    mocks.listeners.set(event, handler);
    return vi.fn();
  }),
}));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn(async () => vi.fn()) }),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => {
  const mainWindow = {
    onCloseRequested: vi.fn(async (handler) => {
      mocks.events.push('listen:close');
      mocks.setCloseHandler(handler);
      return vi.fn();
    }),
    destroy: vi.fn(async () => {
      mocks.events.push('window:destroy');
    }),
    show: vi.fn(async () => {
      mocks.events.push('window:show');
    }),
    setFocus: vi.fn(async () => {
      mocks.events.push('window:focus');
    }),
    unminimize: vi.fn(async () => undefined),
    isFullscreen: vi.fn(async () => false),
    setFullscreen: vi.fn(async () => undefined),
  };
  const auxiliaryWindow = {
    onCloseRequested: vi.fn(async (handler) => {
      mocks.events.push('listen:auxiliary-close');
      mocks.setAuxiliaryCloseHandler(handler);
      return vi.fn();
    }),
    destroy: vi.fn(async () => {
      mocks.events.push('auxiliary:destroy');
    }),
  };
  mocks.setAuxiliaryCloseRequester(async () => {
    let prevented = false;
    await mocks.getAuxiliaryCloseHandler()?.({
      preventDefault: () => {
        prevented = true;
      },
    });
    mocks.events.push(prevented ? 'auxiliary:prevented' : 'auxiliary:closed');
  });
  return {
    getCurrentWebviewWindow: () => mainWindow,
    getAllWebviewWindows: vi.fn(async () => {
      mocks.events.push('windows:all');
      return [mainWindow, auxiliaryWindow];
    }),
  };
});
vi.mock('../app/dialogs', () => ({
  requestUnsavedDocument: vi.fn(async () => 'cancel'),
  requestAnnotationNote: vi.fn(async () => null),
  requestConfirmation: vi.fn(async () => mocks.takeConfirmationChoice()),
  requestPdfPassword: vi.fn(async () => null),
  requestRecoveryDraft: vi.fn(async () => 'discard'),
  showToast: vi.fn(),
}));
vi.mock('../app/dom-events', () => ({ setupEventListeners: vi.fn() }));
vi.mock('../app/file-actions', () => ({
  ensureMinimumViewingSize: vi.fn(async () => undefined),
  openFiles: vi.fn(async () => 0),
  openPDFFile: vi.fn(async () => 0),
  openSettings: vi.fn(async () => undefined),
  reportDocumentIntakeOutcomes: vi.fn(),
  updatePrintMenuState: vi.fn(async () => undefined),
}));
vi.mock('../app/keybinds', () => ({ registerKeybindActions: vi.fn() }));
vi.mock('../app/presentation-controller', () => ({
  PresentationController: class {
    exit = vi.fn(async () => undefined);
    toggle = vi.fn(async () => undefined);
  },
}));
vi.mock('../app/search-controller', () => ({
  SearchController: class {
    open = vi.fn();
    activeDocumentChanged = vi.fn();
  },
}));
vi.mock('../app/sidebar-controller', () => ({
  SidebarController: class {
    annotationsChanged = vi.fn();
    presentationStateChanged = vi.fn();
    activeDocumentChanged = vi.fn();
    setThumbnailsEnabled = vi.fn();
  },
}));
vi.mock('../app/startup-restoration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../app/startup-restoration')>();
  return {
    restoreReadingSessionAtStartup: vi.fn(async (options) => {
      if (mocks.useRealRestoration()) return actual.restoreReadingSessionAtStartup(options);
      const { onForegroundReady } = options;
      mocks.events.push('restoration:start');
      await onForegroundReady?.({
        status: 'opened',
        requestedPath: '/docs/report.pdf',
        filePath: '/docs/report.pdf',
      });
      mocks.events.push('restoration:foreground');
      await mocks.waitForRestoration();
      mocks.events.push('restoration:done');
      return {
        outcomes: [],
        opened: 1,
        failed: 0,
        failedPaths: [],
        explicitRequestResult: { outcomes: [], opened: 0, activated: 0, failed: 0 },
      };
    }),
  };
});
vi.mock('../app/ui', () => ({
  renderRecentFiles: vi.fn(),
  showSplash: vi.fn(),
  showViewer: vi.fn(),
  updateActivePresetButton: vi.fn(),
  updateKeyboardHints: vi.fn(),
  updateTabBarVisibility: vi.fn(),
  updateUI: vi.fn(),
}));
vi.mock('../lib/debug-log', () => ({ debugLog: vi.fn() }));
vi.mock('../reader/annotations', () => ({
  loadAnnotations: vi.fn(async () => ({
    snapshot: vi.fn(() => []),
    replace: vi.fn(),
    clear: vi.fn(),
    isDirty: vi.fn(() => false),
    flush: vi.fn(async () => {
      mocks.events.push('flush:annotations');
    }),
  })),
}));
vi.mock('../reader/reading-session-store', () => ({
  EMPTY_READING_SESSION: { schemaVersion: 2, activeDocumentPath: null, documents: [] },
  loadReadingSession: vi.fn(async () => mocks.savedReadingSession()),
}));
vi.mock('../reader/recent-documents', () => ({
  loadRecentDocuments: vi.fn(async () => ({
    snapshot: vi.fn(() => []),
    record: vi.fn(),
    clear: vi.fn(),
    isDirty: vi.fn(() => false),
    flush: vi.fn(async () => {
      mocks.events.push('flush:recent');
    }),
  })),
}));
vi.mock('../scripts/keybind-manager', () => ({
  KeybindManager: class {
    loadFromSettings = vi.fn();
  },
}));
vi.mock('../scripts/settings', () => ({
  SettingsManager: class {
    load = vi.fn(async () => {
      mocks.events.push('settings:load');
      return {
        general: {
          maximizeOnOpen: false,
          displayThumbs: false,
          defaultDarkMode: 'default',
          rememberLastFilter: false,
          restorePreviousSession: mocks.restorePreviousSession(),
          defaultViewMode: 'continuous',
          annotationDisplayName: mocks.annotationDisplayName(),
        },
        keybinds: {},
      };
    });
    clearPersistedReadingSession = vi.fn(async () => undefined);
    set = vi.fn(async () => undefined);
  },
}));
vi.mock('../scripts/sliders', () => ({
  SliderManager: class {
    setPreset = vi.fn();
  },
}));

function createModules(
  options: {
    intakeQuiescence?: Promise<void>;
    sessionFlushFailures?: number;
    realRestoration?: {
      source: PdfSource;
      createSurface: DocumentSurfaceFactory;
      activeReadingPosition?: {
        filePath: string;
        readingPosition: { page: number; location: number };
      };
    };
    annotationDisplayNameChanged?: (displayName: string) => void;
  } = {},
): ApplicationModules {
  let remainingSessionFlushFailures = options.sessionFlushFailures ?? 0;
  const session: ReadingSessionSnapshot = {
    schemaVersion: 2,
    revision: 0,
    activeDocumentPath: '/docs/report.pdf',
    documents: [
      {
        filePath: '/docs/report.pdf',
        title: 'report.pdf',
        readingPosition: { page: 3, location: 0.25 },
      },
    ],
  };
  const readerActions = {
    dispatch: vi.fn(async (action) => {
      if (action.type === 'settleReadingPosition') mocks.events.push('flush:settle');
      return { status: 'no-op' as const, revision: session.revision };
    }),
    canonicalizeDocumentPaths: vi.fn(async () => ({ status: 'no-op' as const, revision: 0 })),
    query: vi.fn(() => null),
    isDocumentOpen: vi.fn(() => true),
    snapshot: vi.fn(() => session),
    observe: vi.fn(() => vi.fn()),
    quiesce: vi.fn(async () => {
      mocks.events.push('flush:actions-quiesce');
    }),
    flush: vi.fn(async () => {
      mocks.events.push('flush:session');
      if (remainingSessionFlushFailures > 0) {
        remainingSessionFlushFailures -= 1;
        throw new Error('session store unavailable');
      }
    }),
    captureRecoveryDraft: vi.fn(async () => ({ status: 'no-op' as const, revision: 0 })),
    hasUnsavedPdfWork: vi.fn(() => false),
    prepareShutdown: vi.fn(async () => true),
    isShutdownPrepared: vi.fn(() => true),
    cancelShutdown: vi.fn(),
    hasDirtySession: vi.fn(() => false),
  } as ReaderActions;
  const intake = {
    begin: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
    interruptRestoration: vi.fn(() => {
      mocks.events.push('intake:interrupt-restoration');
      mocks.finishRestoration();
    }),
    resumeAccepting: vi.fn(() => {
      mocks.events.push('intake:resume');
    }),
    stopAccepting: vi.fn(() => {
      mocks.events.push('intake:stop');
    }),
    quiesce: vi.fn(async () => {
      mocks.events.push('flush:intake-quiesce');
      await options.intakeQuiescence;
    }),
  } as unknown as DocumentIntake;
  return {
    createAnnotationStorage: vi.fn(() => ({}) as never),
    browserPrintAdapter: { print: vi.fn(async () => undefined) },
    externalLinkAdapter: { open: vi.fn(async () => undefined) },
    createDocumentIntakeRuntime: vi.fn(({ runtime, canonicalizeDocumentPaths }) =>
      options.realRestoration
        ? createRealDocumentIntake({
            source: options.realRestoration.source,
            runtime: {
              ...runtime,
              canonicalizeDocumentPaths,
            },
          })
        : intake,
    ),
    createDocumentWorkspace: vi.fn(
      (workspaceOptions: Parameters<typeof createRealDocumentWorkspace>[0]) => {
        if (options.realRestoration) {
          const workspace = createRealDocumentWorkspace({
            ...workspaceOptions,
            createSurface: options.realRestoration.createSurface,
          });
          return options.realRestoration.activeReadingPosition
            ? {
                ...workspace,
                activeReadingPosition: () => options.realRestoration?.activeReadingPosition ?? null,
              }
            : workspace;
        }
        return {
          intakeRuntime: {},
          projection: {
            activateDocument: vi.fn(async () => undefined),
            goToReadingPosition: vi.fn(async () => undefined),
          },
          project: vi.fn(),
          access: vi.fn(() => null),
          activePresentation: vi.fn(() => null),
          activeRenderingState: vi.fn(() => null),
          activeReadingPosition: vi.fn(() => ({
            filePath: '/docs/report.pdf',
            readingPosition: { page: 4, location: 0.5 },
          })),
          replaceAnnotations: vi.fn(),
          setAnnotationDisplayName: options.annotationDisplayNameChanged ?? vi.fn(),
        };
      },
    ),
    createReadingSessionStorage: vi.fn(
      () =>
        ({
          write: vi.fn(async (snapshot: ReadingSessionSnapshot) => {
            mocks.events.push('persist:session');
            mocks.persistedReadingSessions.push(structuredClone(snapshot));
          }),
        }) as never,
    ),
    createRecentDocumentStorage: vi.fn(() => ({}) as never),
    createReaderActions: vi.fn((readerOptions) =>
      options.realRestoration
        ? createRealReaderActions({ ...readerOptions, persistenceDebounceMs: 0 })
        : readerActions,
    ),
  } as unknown as ApplicationModules;
}

function createLifecycleSurface(filePath: string): {
  surface: DocumentSurface;
  rendering: DocumentRendering;
  destroyRuntime: ReturnType<typeof vi.fn>;
} {
  let readingPosition = { page: 1, location: 0 };
  const destroyRuntime = vi.fn(async () => undefined);
  const rendering = {
    getState: () => ({
      currentPage: readingPosition.page,
      totalPages: 12,
      zoom: 1,
      zoomIntent: { kind: 'manual' as const, scale: 1 },
      rotation: 0,
      fileName: filePath.split('/').pop() ?? filePath,
      filePath,
      viewMode: 'single' as const,
    }),
    getReadingPosition: () => readingPosition,
    applyFilter: vi.fn(),
    setRotation: vi.fn(async () => undefined),
    setViewMode: vi.fn(async () => undefined),
    setZoomIntent: vi.fn(async () => undefined),
    goToReadingPosition: vi.fn(async (position) => {
      readingPosition = { page: position.page, location: position.location ?? 0 };
    }),
    setVisible: vi.fn(),
    destroy: vi.fn(),
  } as unknown as DocumentRendering;
  return {
    rendering,
    destroyRuntime,
    surface: { rendering, runtime: { destroy: destroyRuntime } as never },
  };
}

describe('application lifecycle composition', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.reset();
    document.body.innerHTML = '<span id="version-info"></span>';
  });

  it('propagates persisted annotation attribution through the application workspace', async () => {
    const setAnnotationDisplayName = vi.fn();
    const modules = createModules({ annotationDisplayNameChanged: setAnnotationDisplayName });
    const createDocumentSurface = vi.fn((_options: { getAnnotationDisplayName?: () => string }) =>
      vi.fn(),
    );
    modules.createDocumentSurface = createDocumentSurface as never;
    const { initializeApplication } = await import('../application');
    const initialization = initializeApplication(modules);
    await vi.waitFor(() => expect(mocks.events).toContain('restoration:foreground'));
    mocks.finishRestoration();
    await initialization;
    const getAnnotationDisplayName = createDocumentSurface.mock.calls[0]?.[0]
      .getAnnotationDisplayName as () => string;

    expect(getAnnotationDisplayName()).toBe('Guest');

    mocks.setAnnotationDisplayName('Ada Lovelace');
    await mocks.listeners.get('settings-changed')?.();

    expect(getAnnotationDisplayName()).toBe('Ada Lovelace');
    expect(setAnnotationDisplayName).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('reveals a persistent startup error when initialization fails before the window is shown', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const modules = createModules();
    modules.createRecentDocumentStorage = vi.fn(() => {
      throw new Error('startup storage failed');
    });
    const { initializeApplication } = await import('../application');

    try {
      await initializeApplication(modules);

      expect(mocks.events).toContain('window:show');
      expect(mocks.events).toContain('window:focus');
      expect(document.getElementById('version-info')).toMatchObject({
        textContent: 'Startup failed: startup storage failed',
      });
      expect(document.getElementById('version-info')?.getAttribute('role')).toBe('alert');
      expect(consoleError).toHaveBeenCalledWith(
        'Initialization error:',
        expect.objectContaining({ message: 'startup storage failed' }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('shows the main window and resumes normal startup when initialization-time Quit is cancelled', async () => {
    const { initializeApplication } = await import('../application');
    const modules = createModules();
    const createActions = modules.createReaderActions;
    modules.createReaderActions = (options) => {
      const actions = createActions(options);
      actions.prepareShutdown = async () => false;
      return actions;
    };
    const initialization = initializeApplication(modules);
    await vi.waitFor(() => expect(mocks.events).toContain('restoration:foreground'));
    const quitting = mocks.listeners.get('application-quit-requested')?.();
    await Promise.all([initialization, quitting]);
    expect(mocks.events).toContain('window:show');
    expect(mocks.events).not.toContain('quit');
    expect(mocks.events).toContain('intake:resume');
  });

  it('retains Quit during restoration and flushes every authority before exit', async () => {
    const { initializeApplication } = await import('../application');
    const initialization = initializeApplication(createModules());

    await vi.waitFor(() => expect(mocks.events).toContain('restoration:foreground'));
    expect(mocks.events.indexOf('listen:close')).toBeLessThan(
      mocks.events.indexOf('settings:load'),
    );
    expect(mocks.events.indexOf('listen:application-quit-requested')).toBeLessThan(
      mocks.events.indexOf('restoration:start'),
    );
    expect(mocks.events.indexOf('invoke:complete_frontend_lifecycle_registration')).toBeLessThan(
      mocks.events.indexOf('restoration:start'),
    );

    const quitting = mocks.listeners.get('application-quit-requested')?.();
    await Promise.resolve();
    expect(mocks.events).toContain('intake:stop');
    expect(mocks.events).toContain('intake:interrupt-restoration');
    expect(mocks.events).not.toContain('flush:intake-quiesce');
    expect(mocks.events).not.toContain('invoke:complete_application_quit');

    await Promise.all([initialization, quitting]);

    const ordered = [
      'intake:interrupt-restoration',
      'restoration:done',
      'flush:intake-quiesce',
      'flush:actions-quiesce',
      'flush:settle',
      'flush:session',
      'flush:annotations',
      'flush:recent',
      'invoke:complete_application_quit',
    ];
    expect(ordered.map((event) => mocks.events.indexOf(event))).toEqual(
      [...ordered.map((event) => mocks.events.indexOf(event))].sort((left, right) => left - right),
    );
  });

  it('retains a native Quit that predates frontend initialization', async () => {
    mocks.setPendingQuit(true);
    const { initializeApplication } = await import('../application');
    const initialization = initializeApplication(createModules());

    await vi.waitFor(() => expect(mocks.events).toContain('restoration:foreground'));
    expect(mocks.events).not.toContain('window:show');
    await initialization;

    expect(mocks.events).toContain('intake:interrupt-restoration');
    expect(mocks.events).toContain('flush:intake-quiesce');
    expect(mocks.events).toContain('invoke:complete_application_quit');
    expect(mocks.events).not.toContain('window:destroy');
  });

  it('persists completed foreground changes while retaining interrupted Reading Session Documents', async () => {
    mocks.setUseRealRestoration(true);
    mocks.setSavedReadingSession({
      schemaVersion: 2,
      activeDocumentPath: '/docs/active.pdf',
      documents: [
        {
          filePath: '/docs/active.pdf',
          title: 'active.pdf',
          readingPosition: { page: 2, location: 0.25 },
        },
        {
          filePath: '/docs/missing.pdf',
          title: 'missing.pdf',
          readingPosition: { page: 3, location: 0.25 },
        },
        {
          filePath: '/docs/password.pdf',
          title: 'password.pdf',
          readingPosition: { page: 4, location: 0.25 },
        },
        {
          filePath: '/docs/later.pdf',
          title: 'later.pdf',
          readingPosition: { page: 5, location: 0.25 },
        },
      ],
    });
    let passwordPending = false;
    const createdSurfaces = new Map<string, ReturnType<typeof createLifecycleSurface>>();
    const createSurface = vi.fn(({ filePath, signal }) => {
      const controlled = createLifecycleSurface(filePath);
      createdSurfaces.set(filePath, controlled);
      mocks.events.push(`surface:create:${filePath}`);
      if (filePath !== '/docs/password.pdf') return Promise.resolve(controlled.surface);
      passwordPending = true;
      return new Promise<DocumentSurface>((resolve) => {
        signal?.addEventListener('abort', () => resolve(controlled.surface), { once: true });
      });
    });
    const modules = createModules({
      realRestoration: {
        source: {
          describe: vi.fn(async (filePath) => {
            if (filePath === '/docs/missing.pdf') throw new Error('missing');
            return { canonicalPath: filePath, title: filePath.split('/').pop() ?? filePath };
          }),
          read: vi.fn(async () => new Uint8Array([1])),
        },
        createSurface,
        activeReadingPosition: {
          filePath: '/docs/active.pdf',
          readingPosition: { page: 9, location: 0.5 },
        },
      },
    });
    const { initializeApplication } = await import('../application');
    const initialization = initializeApplication(modules);

    await vi.waitFor(() => expect(passwordPending).toBe(true));
    const quitting = mocks.listeners.get('application-quit-requested')?.();
    await Promise.all([initialization, quitting]);

    expect(mocks.events).not.toContain('surface:create:/docs/later.pdf');
    expect(mocks.events).toContain('invoke:complete_application_quit');
    await vi.waitFor(() =>
      expect(createdSurfaces.get('/docs/password.pdf')?.rendering.destroy).toHaveBeenCalledOnce(),
    );
    expect(createdSurfaces.get('/docs/password.pdf')?.destroyRuntime).toHaveBeenCalledOnce();
    expect(mocks.persistedReadingSessions[mocks.persistedReadingSessions.length - 1]).toMatchObject(
      {
        activeDocumentPath: '/docs/active.pdf',
        documents: [
          {
            filePath: '/docs/active.pdf',
            readingPosition: { page: 9, location: 0.5 },
          },
          { filePath: '/docs/password.pdf' },
          { filePath: '/docs/later.pdf' },
        ],
      },
    );
  });

  it('coalesces repeated mixed requests through the production lifecycle', async () => {
    let releaseFinalFlush!: () => void;
    const finalFlushBarrier = new Promise<void>((resolve) => {
      releaseFinalFlush = resolve;
    });
    const { initializeApplication } = await import('../application');
    const initialization = initializeApplication(
      createModules({ intakeQuiescence: finalFlushBarrier }),
    );
    await vi.waitFor(() => expect(mocks.events).toContain('restoration:foreground'));
    mocks.finishRestoration();
    await initialization;

    let prevented = 0;
    const closeEvent = {
      preventDefault: () => {
        prevented += 1;
      },
    };
    const firstClose = mocks.getCloseHandler()?.(closeEvent);
    await vi.waitFor(() => expect(mocks.events).toContain('flush:intake-quiesce'));
    const repeatedClose = mocks.getCloseHandler()?.(closeEvent);
    const quit = mocks.listeners.get('application-quit-requested')?.();
    releaseFinalFlush();
    await Promise.all([firstClose, repeatedClose, quit]);

    expect(prevented).toBe(2);
    expect(mocks.events.filter((event) => event === 'flush:session')).toHaveLength(1);
    expect(
      mocks.events.filter((event) => event === 'invoke:complete_application_quit'),
    ).toHaveLength(1);
    expect(mocks.events).not.toContain('window:destroy');
  });

  it('retries failed final persistence before destroying the main window', async () => {
    mocks.setConfirmationChoices([true]);
    const { initializeApplication } = await import('../application');
    const initialization = initializeApplication(createModules({ sessionFlushFailures: 1 }));
    await vi.waitFor(() => expect(mocks.events).toContain('restoration:foreground'));
    const closing = mocks.getCloseHandler()?.({ preventDefault: vi.fn() });
    await Promise.all([initialization, closing]);

    expect(mocks.events).toContain('intake:interrupt-restoration');
    expect(mocks.events.filter((event) => event === 'flush:session')).toHaveLength(2);
    expect(mocks.events).toContain('confirmation:true');
    expect(mocks.events).toContain('window:destroy');
  });

  it('destroys only after explicit quit-without-saving choice', async () => {
    mocks.setConfirmationChoices([false]);
    const { initializeApplication } = await import('../application');
    const initialization = initializeApplication(createModules({ sessionFlushFailures: 1 }));
    await vi.waitFor(() => expect(mocks.events).toContain('restoration:foreground'));
    const closing = mocks.getCloseHandler()?.({ preventDefault: vi.fn() });
    await Promise.all([initialization, closing]);

    expect(mocks.events).toContain('intake:interrupt-restoration');
    expect(mocks.events.filter((event) => event === 'flush:session')).toHaveLength(1);
    expect(mocks.events).toContain('confirmation:false');
    expect(mocks.events).toContain('window:destroy');
  });

  it('skips Reading Session persistence when restoration is disabled', async () => {
    mocks.setRestorePreviousSession(false);
    const { initializeApplication } = await import('../application');
    await initializeApplication(createModules());

    await mocks.getCloseHandler()?.({ preventDefault: vi.fn() });

    expect(mocks.events).toContain('flush:actions-quiesce');
    expect(mocks.events).not.toContain('flush:settle');
    expect(mocks.events).not.toContain('flush:session');
    expect(mocks.events).toContain('flush:annotations');
    expect(mocks.events).toContain('flush:recent');
    expect(mocks.events).toContain('window:destroy');
  });

  it('registers shutdown only on the composed main window', async () => {
    mocks.setRestorePreviousSession(false);
    const { initializeApplication } = await import('../application');
    await initializeApplication(createModules());

    expect(mocks.getCloseHandler()).toBeTypeOf('function');
    expect(mocks.getAuxiliaryCloseHandler()).toBeNull();
    expect(mocks.events).not.toContain('windows:all');
    expect(mocks.events.filter((event) => event === 'listen:close')).toHaveLength(1);

    await mocks.requestAuxiliaryClose();

    expect(mocks.events).toContain('auxiliary:closed');
    expect(mocks.events).not.toContain('auxiliary:prevented');
    expect(mocks.events).not.toContain('intake:stop');
    expect(mocks.events).not.toContain('flush:intake-quiesce');
    expect(mocks.events).not.toContain('window:destroy');
    expect(mocks.events).not.toContain('auxiliary:destroy');
  });
});
