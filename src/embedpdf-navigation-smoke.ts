import { PdfErrorCode, PdfTaskHelper } from '@embedpdf/models';
import type { EmbedPdfContainer } from '@embedpdf/snippet';
import { navigationPdf } from './__fixtures__/navigation-pdf';
import { createDocumentWorkspace } from './app/document-workspace';
import { createEmbedPdfDocumentSurfaceFactory } from './app/embedpdf-document-surface';
import { createTauriExternalLinkAdapter } from './app/tauri-external-link-adapter';
import {
  createReaderActions,
  type ReaderAction,
  type ReaderActions,
} from './reader/reader-actions';
import { PRESETS } from './scripts/filters';
import { KeybindManager } from './scripts/keybind-manager';
import { DEFAULT_SETTINGS } from './scripts/settings';
import './styles/document-workspace.css';
import './styles/reader-shell.css';

async function run() {
  const actions: ReaderAction[] = [];
  const externalUrls: string[] = [];
  const errors: string[] = [];
  const initialSession = { schemaVersion: 2 as const, activeDocumentPath: null, documents: [] };
  let reader: ReaderActions;
  const workspace = createDocumentWorkspace({
    dispatchReaderAction: async (action, options) => {
      actions.push(action);
      return reader.dispatch(action, options);
    },
    snapshot: () => reader?.snapshot() ?? { ...initialSession, revision: 0 },
    isDocumentOpen: (path) => reader?.isDocumentOpen(path) ?? false,
    defaultVisualState: () => ({
      filterSettings: PRESETS.default,
      zoomIntent: { kind: 'manual', scale: 1 },
      rotation: 0,
      viewMode: 'continuous',
    }),
    createSurface: createEmbedPdfDocumentSurfaceFactory(),
  });
  reader = createReaderActions({
    initialSession,
    projection: workspace.projection,
    persist: async () => undefined,
    externalLinkAdapter: createTauriExternalLinkAdapter(async (command, args) => {
      if (command !== 'open_external_url') throw new Error(`Unexpected command: ${command}`);
      const url = String(args?.url);
      externalUrls.push(url);
      // Substitute only the desktop boundary; native policy has Rust contract coverage.
      if (!/^https?:|^mailto:/.test(url)) {
        errors.push('Unsupported external URL scheme');
        throw new Error('Unsupported external URL scheme');
      }
    }),
  });
  reader.observe((snapshot) => workspace.project(snapshot));
  const open = (path: string) =>
    workspace.intakeRuntime.open({
      document: { canonicalPath: path, title: path.split('/').pop() ?? path },
      bytes: navigationPdf(path),
      activate: true,
    });
  const manager = new KeybindManager(true);
  manager.loadFromSettings(DEFAULT_SETTINGS);
  const shortcuts: string[] = [];
  document.addEventListener('keydown', (event) => {
    const action = manager.matchEvent(event);
    if (action) {
      shortcuts.push(action);
      event.preventDefault();
    }
  });
  await open('/docs/first.pdf');
  return {
    reader,
    workspace,
    open,
    actions,
    externalUrls,
    errors,
    shortcuts,
    access: () => workspace.access(reader.query()),
    async failNextSearch() {
      const container = document.querySelector<EmbedPdfContainer>(
        '.embedpdf-document-surface[data-visible="true"] embedpdf-container',
      );
      if (!container) throw new Error('No active viewer');
      const engine = (await container.registry).getEngine();
      const originalSearch = engine.searchAllPages.bind(engine);
      engine.searchAllPages = () => {
        engine.searchAllPages = originalSearch;
        return PdfTaskHelper.reject({
          code: PdfErrorCode.Unknown,
          message: 'Injected engine search failure',
        });
      };
    },
  };
}

declare global {
  interface Window {
    navigationSmoke: Awaited<ReturnType<typeof run>>;
  }
}

void run()
  .then((harness) => {
    window.navigationSmoke = harness;
    document.body.dataset.status = 'ready';
  })
  .catch((error) => {
    document.body.dataset.status = 'failed';
    document.body.dataset.error = String(error);
  });
