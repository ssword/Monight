import { inspectNativePdfEditing, nativePdfSaveAdapter } from './app/native-pdf-save-adapter';
import 'nouislider/dist/nouislider.css';
import { createAnnotationStorage } from './app/annotation-storage';
import { browserPrintAdapter } from './app/browser-print-adapter';
import { createDocumentIntakeRuntime } from './app/document-intake-runtime';
import {
  createDevelopmentDocumentSurfaceProvider,
  resolveDocumentSurfaceKind,
} from './app/document-surface-gate';
import { createDocumentWorkspace } from './app/document-workspace';
import { createReadingSessionStorage } from './app/reading-session-storage';
import { createRecentDocumentStorage } from './app/recent-document-storage';
import { nativeRecoveryDraftAdapter } from './app/recovery-draft-adapter';
import { createTauriExternalLinkAdapter } from './app/tauri-external-link-adapter';
import { initializeApplication } from './application';
import { createReaderActions } from './reader/reader-actions';
import './styles/configurator.css';
import './styles/dialogs.css';
import './styles/document-features.css';
import './styles/main.css';
import './styles/pdf-viewer.css';
import './styles/tabs.css';

const documentSurfaceKind = resolveDocumentSurfaceKind(import.meta.env.VITE_PDF_SURFACE);
document.documentElement.dataset.pdfSurface = documentSurfaceKind;
const nativePdfEditingEnabled = import.meta.env.VITE_NATIVE_PDF_EDITING === '1';
const createDocumentSurface = createDevelopmentDocumentSurfaceProvider(
  import.meta.env.VITE_PDF_SURFACE,
  undefined,
  nativePdfEditingEnabled ? inspectNativePdfEditing : undefined,
);

const startApplication = () =>
  initializeApplication({
    createAnnotationStorage,
    browserPrintAdapter,
    ...(createDocumentSurface ? { pdfSaveAdapter: nativePdfSaveAdapter } : {}),
    ...(createDocumentSurface && nativePdfEditingEnabled
      ? { recoveryDraftAdapter: nativeRecoveryDraftAdapter }
      : {}),
    createDocumentIntakeRuntime,
    createDocumentWorkspace,
    ...(createDocumentSurface ? { createDocumentSurface } : {}),
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
