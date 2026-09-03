import type { ViewMode } from '../lib/document-features';
import {
  createDocumentIntake,
  createDocumentIntakeCoordinator,
  type DocumentIntake,
  type DocumentIntakeCoordinator,
} from '../reader/document-intake';
import type { PdfSource } from '../reader/pdf-source';
import type { DocumentPathReconciliation } from '../reader/reading-session';
import type { FilterSettings } from '../scripts/filters';
import type { TabManager } from '../scripts/tabs';
import { createTauriPdfSource } from './pdf-source';

interface CreateDocumentIntakeRuntimeOptions {
  tabManager: TabManager;
  initialFilterSettings?: FilterSettings;
  initialViewMode?: ViewMode;
  source?: PdfSource;
  canonicalizeDocumentPaths?: (paths: readonly DocumentPathReconciliation[]) => Promise<void>;
}

const intakeCoordinators = new WeakMap<TabManager, DocumentIntakeCoordinator>();

function coordinatorFor(tabManager: TabManager): DocumentIntakeCoordinator {
  const existing = intakeCoordinators.get(tabManager);
  if (existing) return existing;
  const coordinator = createDocumentIntakeCoordinator();
  intakeCoordinators.set(tabManager, coordinator);
  return coordinator;
}

export function createDocumentIntakeRuntime({
  tabManager,
  initialFilterSettings,
  initialViewMode,
  source = createTauriPdfSource(),
  canonicalizeDocumentPaths,
}: CreateDocumentIntakeRuntimeOptions): DocumentIntake {
  return createDocumentIntake({
    coordinator: coordinatorFor(tabManager),
    source,
    runtime: {
      isOpen: (filePath) => tabManager.getTabs().some((tab) => tab.filePath === filePath),
      activate: async (filePath, options) => {
        const tab = tabManager.getTabs().find((item) => item.filePath === filePath);
        if (!tab) throw new Error(`Cannot activate unopened Document: ${filePath}`);
        if (options?.notifyOpened === false) {
          await tabManager.reactivateOpenDocument(tab.id, { notifyOpened: false });
          return;
        }
        await tabManager.reactivateOpenDocument(tab.id);
      },
      notifyOpened: async (filePath) => {
        await tabManager.notifyDocumentOpened(filePath);
      },
      open: async ({ document, bytes, activate, initialPage, notifyOpened, restoredDocument }) => {
        await tabManager.createTab(
          document.canonicalPath,
          document.title,
          bytes,
          initialFilterSettings,
          initialViewMode ?? 'single',
          {
            activate,
            ...(initialPage !== undefined ? { initialPage } : {}),
            ...(notifyOpened !== undefined ? { notifyOpened } : {}),
            ...(restoredDocument ? { restoredDocument } : {}),
          },
        );
      },
      goToPage: async (filePath, page) => {
        await tabManager.requestDocumentPage(filePath, page);
      },
      ...(canonicalizeDocumentPaths ? { canonicalizeDocumentPaths } : {}),
      setDocumentOrder: (filePaths) => {
        tabManager.setDocumentOrder(filePaths);
      },
    },
  });
}
