import { inspectNativePdfEditing, nativePdfSaveAdapter } from './app/native-pdf-save-adapter';
import 'nouislider/dist/nouislider.css';
import { browserPrintAdapter } from './app/browser-print-adapter';
import { createDocumentIntakeRuntime } from './app/document-intake-runtime';
import { createDocumentWorkspace, type DocumentSurfaceProvider } from './app/document-workspace';
import { createEmbedPdfDocumentSurfaceFactory } from './app/embedpdf-document-surface';
import { createReadingSessionStorage } from './app/reading-session-storage';
import { createRecentDocumentStorage } from './app/recent-document-storage';
import { nativeRecoveryDraftAdapter } from './app/recovery-draft-adapter';
import { createTauriExternalLinkAdapter } from './app/tauri-external-link-adapter';
import { initializeApplication } from './application';
import { createReaderActions } from './reader/reader-actions';
import './styles/configurator.css';
import './styles/dialogs.css';
import './styles/document-workspace.css';
import './styles/main.css';
import './styles/reader-shell.css';
import './styles/tabs.css';

const createDocumentSurface: DocumentSurfaceProvider = (options) =>
  createEmbedPdfDocumentSurfaceFactory({ ...options, assessEditing: inspectNativePdfEditing });

const startApplication = () =>
  initializeApplication({
    browserPrintAdapter,
    pdfSaveAdapter: nativePdfSaveAdapter,
    recoveryDraftAdapter: nativeRecoveryDraftAdapter,
    createDocumentIntakeRuntime,
    createDocumentWorkspace,
    createDocumentSurface,
    createReadingSessionStorage,
    createRecentDocumentStorage,
    externalLinkAdapter: createTauriExternalLinkAdapter(),
    createReaderActions,
  });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApplication);
} else {
  void startApplication();
}
