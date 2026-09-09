import { navigationPdf } from './__fixtures__/navigation-pdf';
import { createDocumentIntakeRuntime } from './app/document-intake-runtime';
import { createDocumentWorkspace } from './app/document-workspace';
import { setupEventListeners } from './app/dom-events';
import { createEmbedPdfDocumentSurfaceFactory } from './app/embedpdf-document-surface';
import { registerKeybindActions } from './app/keybinds';
import { restoreReadingSessionAtStartup } from './app/startup-restoration';
import type { DocumentContent } from './reader/document-content';
import {
  createReaderActions,
  type ReaderAction,
  type ReaderActions,
} from './reader/reader-actions';
import { EMPTY_READING_SESSION } from './reader/reading-session-store';
import { PRESETS } from './scripts/filters';
import { KeybindManager } from './scripts/keybind-manager';
import { DEFAULT_SETTINGS } from './scripts/settings';
import './styles/document-features.css';

async function run() {
  const saved =
    JSON.parse(localStorage.getItem('reading-session') ?? 'null') ?? EMPTY_READING_SESSION;
  const actions: ReaderAction[] = [];
  const contents = new Map<string, DocumentContent>();
  const createSurface = createEmbedPdfDocumentSurfaceFactory();
  let reader: ReaderActions;
  const dispatch: ReaderActions['dispatch'] = (action, options) => {
    actions.push(action);
    return reader.dispatch(action, options);
  };
  const workspace = createDocumentWorkspace({
    dispatchReaderAction: dispatch,
    snapshot: () => reader?.snapshot() ?? { ...saved, revision: 0 },
    isDocumentOpen: (path) => reader?.isDocumentOpen(path) ?? false,
    defaultVisualState: () => ({
      filterSettings: PRESETS.default,
      zoomIntent: { kind: 'manual', scale: 1 },
      rotation: 0,
      viewMode: 'continuous',
    }),
    createSurface: async (request) => {
      const surface = await createSurface(request);
      contents.set(request.filePath, surface.runtime.content);
      return surface;
    },
  });
  reader = createReaderActions({
    initialSession: saved,
    projection: workspace.projection,
    persist: async (snapshot) => localStorage.setItem('reading-session', JSON.stringify(snapshot)),
  });
  reader.observe((snapshot) => workspace.project(snapshot));
  const intake = createDocumentIntakeRuntime({
    canonicalizeDocumentPaths: async (paths) => {
      await reader.canonicalizeDocumentPaths(paths);
    },
    source: {
      describe: async (path) => ({
        canonicalPath: path.replace('/alias/', '/docs/'),
        title: path.split('/').pop() ?? path,
      }),
      read: async (path) =>
        path.endsWith('broken.pdf')
          ? new Uint8Array([1, 2])
          : navigationPdf(path, path.endsWith('native.pdf') ? 90 : 0),
    },
    runtime: workspace.intakeRuntime,
  });
  const manager = new KeybindManager(false);
  manager.loadFromSettings(DEFAULT_SETTINGS);
  const goToPage = async (page: number) => {
    await dispatch({ type: 'goToPage', page });
  };
  const goToRelativePage = async (direction: 'next' | 'previous') => {
    await dispatch({ type: direction === 'next' ? 'goToNextPage' : 'goToPreviousPage' });
  };
  registerKeybindActions({
    keybindManager: manager,
    getReadingSessionSnapshot: () => reader.snapshot(),
    getActivePageCount: async () => workspace.activeRenderingState()?.totalPages ?? 0,
    openPdfAndRefresh: async () => {},
    openSettings: async () => {},
    updateTabBarVisibility: () => {},
    updateUI: () => {},
    openSearch: () => workspace.access(reader.query())?.presentation.openSearch?.(),
    togglePresentationMode: async () => {},
    goToPage,
    goToRelativePage,
    dispatchReaderAction: async (action) => {
      await dispatch(action);
    },
  });
  setupEventListeners({
    sliderManager: null,
    keybindManager: manager,
    openPdfAndRefresh: async () => {},
    updateUI: () => {},
    activateDocument: async (filePath) => {
      await dispatch({ type: 'activateDocument', filePath });
    },
    openRecentFile: async () => {},
    clearRecentFiles: async () => {},
    goToPage,
    goToRelativePage,
    dispatchReaderAction: async (action) => {
      await dispatch(action);
    },
  });
  const failures: string[] = [];
  const restoration = saved.documents.length
    ? await restoreReadingSessionAtStartup({
        intake,
        session: saved,
        pruneDocument: async (filePath) => {
          await reader.dispatch({ type: 'removeDocument', filePath });
        },
        reportFailure: (message) => failures.push(message),
      })
    : await intake.open(['/docs/first.pdf']);
  workspace.project(reader.snapshot());
  return { reader, workspace, intake, actions, manager, restoration, failures, contents };
}

declare global {
  interface Window {
    readingSmoke: Awaited<ReturnType<typeof run>>;
  }
}

void run()
  .then((harness) => {
    window.readingSmoke = harness;
    document.body.dataset.status = 'ready';
  })
  .catch((error) => {
    document.body.dataset.status = 'failed';
    document.body.dataset.error = String(error);
  });
