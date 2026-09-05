import 'nouislider/dist/nouislider.css';
import { createAnnotationStorage } from './app/annotation-storage';
import { browserPrintAdapter } from './app/browser-print-adapter';
import { createDocumentIntakeRuntime } from './app/document-intake-runtime';
import { createDocumentWorkspace } from './app/document-workspace';
import { createReadingSessionStorage } from './app/reading-session-storage';
import { createRecentDocumentStorage } from './app/recent-document-storage';
import { createTauriExternalLinkAdapter } from './app/tauri-external-link-adapter';
import { initializeApplication } from './application';
import { createReaderActions } from './reader/reader-actions';
import './styles/configurator.css';
import './styles/dialogs.css';
import './styles/document-features.css';
import './styles/main.css';
import './styles/pdf-viewer.css';
import './styles/tabs.css';

const startApplication = () =>
  initializeApplication({
    createAnnotationStorage,
    browserPrintAdapter,
    createDocumentIntakeRuntime,
    createDocumentWorkspace,
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
