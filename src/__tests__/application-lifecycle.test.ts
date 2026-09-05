// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationModules } from '../application';
import type { DocumentIntake } from '../reader/document-intake';
import type { ReaderActions, ReadingSessionSnapshot } from '../reader/reader-actions';

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
  let confirmationChoices: boolean[] = [];
  let finishRestoration: (() => void) | null = null;
  let restorationBarrier = Promise.resolve();

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
      confirmationChoices = [];
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
  requestAnnotationNote: vi.fn(async () => null),
  requestConfirmation: vi.fn(async () => mocks.takeConfirmationChoice()),
  requestPdfPassword: vi.fn(async () => null),
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
vi.mock('../app/startup-restoration', () => ({
  restoreReadingSessionAtStartup: vi.fn(async ({ onForegroundReady }) => {
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
}));
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
  loadReadingSession: vi.fn(async () => ({
    schemaVersion: 2,
    activeDocumentPath: '/docs/report.pdf',
    documents: [
      {
        filePath: '/docs/report.pdf',
        title: 'report.pdf',
        readingPosition: { page: 3, location: 0.25 },
      },
    ],
  })),
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
  options: { intakeQuiescence?: Promise<void>; sessionFlushFailures?: number } = {},
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
    hasDirtySession: vi.fn(() => false),
  } as ReaderActions;
  const intake = {
    begin: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
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
    createDocumentIntakeRuntime: vi.fn(() => intake),
    createDocumentWorkspace: vi.fn(() => ({
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
    })),
    createReadingSessionStorage: vi.fn(() => ({}) as never),
    createRecentDocumentStorage: vi.fn(() => ({}) as never),
    createReaderActions: vi.fn(() => readerActions),
  } as unknown as ApplicationModules;
}

describe('application lifecycle composition', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.reset();
    document.body.innerHTML = '<span id="version-info"></span>';
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
    expect(mocks.events).not.toContain('flush:intake-quiesce');
    expect(mocks.events).not.toContain('invoke:complete_application_quit');

    mocks.finishRestoration();
    await Promise.all([initialization, quitting]);

    const ordered = [
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
    expect(mocks.events).not.toContain('flush:intake-quiesce');

    mocks.finishRestoration();
    await initialization;

    expect(mocks.events).toContain('flush:intake-quiesce');
    expect(mocks.events).toContain('invoke:complete_application_quit');
    expect(mocks.events).not.toContain('window:destroy');
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
    mocks.finishRestoration();
    await initialization;

    await mocks.getCloseHandler()?.({ preventDefault: vi.fn() });

    expect(mocks.events.filter((event) => event === 'flush:session')).toHaveLength(2);
    expect(mocks.events).toContain('confirmation:true');
    expect(mocks.events).toContain('window:destroy');
  });

  it('destroys only after explicit quit-without-saving choice', async () => {
    mocks.setConfirmationChoices([false]);
    const { initializeApplication } = await import('../application');
    const initialization = initializeApplication(createModules({ sessionFlushFailures: 1 }));
    await vi.waitFor(() => expect(mocks.events).toContain('restoration:foreground'));
    mocks.finishRestoration();
    await initialization;

    await mocks.getCloseHandler()?.({ preventDefault: vi.fn() });

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
