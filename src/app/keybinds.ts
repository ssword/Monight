import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { debugLog } from '../lib/debug-log';
import {
  type DispatchReaderAction,
  type ReadingSessionSnapshot,
  readerAction,
} from '../reader/reader-actions';
import type { KeybindManager } from '../scripts/keybind-manager';

interface KeybindContext {
  keybindManager: KeybindManager | null;
  getReadingSessionSnapshot: () => ReadingSessionSnapshot;
  getActivePageCount: () => Promise<number>;
  openPdfAndRefresh: () => Promise<void>;
  openSettings: () => Promise<void>;
  updateTabBarVisibility: () => void;
  updateUI: () => void;
  openSearch: () => void;
  togglePresentationMode: () => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  goToRelativePage: (direction: 'next' | 'previous') => Promise<void>;
  dispatchReaderAction: DispatchReaderAction;
}

// Register all keybind actions with the KeybindManager
export function registerKeybindActions({
  keybindManager,
  getReadingSessionSnapshot,
  getActivePageCount,
  openPdfAndRefresh,
  openSettings,
  updateTabBarVisibility,
  updateUI,
  openSearch,
  togglePresentationMode,
  goToPage,
  goToRelativePage,
  dispatchReaderAction,
}: KeybindContext): void {
  if (!keybindManager) {
    console.error('KeybindManager not initialized');
    return;
  }

  // File operations
  keybindManager.registerAction('openFile', async () => {
    await openPdfAndRefresh();
  });

  keybindManager.registerAction('print', async () => {
    await dispatchReaderAction({ type: 'printDocument' });
  });

  keybindManager.registerAction('openSettings', async () => {
    await openSettings();
  });

  keybindManager.registerAction('find', () => {
    openSearch();
  });

  // Tab management
  keybindManager.registerAction('closeTab', async () => {
    const activeDocumentPath = getReadingSessionSnapshot().activeDocumentPath;
    if (activeDocumentPath) {
      await dispatchReaderAction({ type: 'closeDocument', filePath: activeDocumentPath });
      updateTabBarVisibility();
    }
  });

  keybindManager.registerAction('reopenTab', async () => {
    await dispatchReaderAction({ type: 'reopenLastClosedDocument' });
    updateTabBarVisibility();
  });

  keybindManager.registerAction('nextTab', async () => {
    const snapshot = getReadingSessionSnapshot();
    const currentIndex = snapshot.documents.findIndex(
      ({ filePath }) => filePath === snapshot.activeDocumentPath,
    );
    if (snapshot.documents.length > 1) {
      const document = snapshot.documents[(currentIndex + 1) % snapshot.documents.length];
      if (document)
        await dispatchReaderAction({ type: 'activateDocument', filePath: document.filePath });
    }
  });

  keybindManager.registerAction('previousTab', async () => {
    const snapshot = getReadingSessionSnapshot();
    const currentIndex = snapshot.documents.findIndex(
      ({ filePath }) => filePath === snapshot.activeDocumentPath,
    );
    if (snapshot.documents.length > 1) {
      const index = (currentIndex - 1 + snapshot.documents.length) % snapshot.documents.length;
      const document = snapshot.documents[index];
      if (document)
        await dispatchReaderAction({ type: 'activateDocument', filePath: document.filePath });
    }
  });

  keybindManager.registerAction('switchToTab', async (_e, data) => {
    const position = data ? parseInt(data, 10) : 1;
    const documents = getReadingSessionSnapshot().documents;
    const document = position === 9 ? documents[documents.length - 1] : documents[position - 1];
    if (document)
      await dispatchReaderAction({ type: 'activateDocument', filePath: document.filePath });
  });

  // PDF navigation (requires active tab)
  keybindManager.registerAction('nextPage', async () => {
    await goToRelativePage('next');
    updateUI();
  });

  keybindManager.registerAction('previousPage', async () => {
    await goToRelativePage('previous');
    updateUI();
  });

  keybindManager.registerAction('firstPage', async () => {
    await goToPage(1);
    updateUI();
  });

  keybindManager.registerAction('lastPage', async () => {
    const pageCount = await getActivePageCount();
    if (pageCount < 1) return;
    await goToPage(pageCount);
    updateUI();
  });

  // Zoom
  keybindManager.registerAction('zoomIn', async () => {
    await dispatchReaderAction(readerAction.zoomIn());
  });

  keybindManager.registerAction('zoomOut', async () => {
    await dispatchReaderAction(readerAction.zoomOut());
  });

  keybindManager.registerAction('resetZoom', async () => {
    await dispatchReaderAction(readerAction.setZoomIntent({ kind: 'manual', scale: 1 }));
  });

  // Fit modes
  keybindManager.registerAction('fitToWidth', async () => {
    await dispatchReaderAction(readerAction.setZoomIntent({ kind: 'fit-width' }));
  });

  keybindManager.registerAction('fitToPage', async () => {
    await dispatchReaderAction(readerAction.setZoomIntent({ kind: 'fit-page' }));
  });

  // Rotation
  keybindManager.registerAction('rotateRight', async () => {
    await dispatchReaderAction(readerAction.rotateClockwise());
  });

  keybindManager.registerAction('rotateLeft', async () => {
    await dispatchReaderAction(readerAction.rotateCounterClockwise());
  });

  // Fullscreen
  keybindManager.registerAction('toggleFullscreen', async () => {
    const currentWindow = getCurrentWebviewWindow();
    const isFullscreen = await currentWindow.isFullscreen();
    await currentWindow.setFullscreen(!isFullscreen);
  });

  keybindManager.registerAction('presentationMode', async () => {
    await togglePresentationMode();
  });

  debugLog('All keybind actions registered');
}
