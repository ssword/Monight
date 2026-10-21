import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { debugLog } from '../lib/debug-log';
import type { DispatchReaderAction, ReadingSessionSnapshot } from '../reader/reader-actions';
import type { KeybindManager } from '../scripts/keybind-manager';
import { READER_ACTION_COMMANDS } from './reader-commands';

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

/** Enter Full Screen: fills the screen with the window without presenting. */
export async function toggleWindowFullScreen(): Promise<void> {
  const currentWindow = getCurrentWebviewWindow();
  await currentWindow.setFullscreen(!(await currentWindow.isFullscreen()));
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
    await dispatchReaderAction(READER_ACTION_COMMANDS.zoomIn());
  });

  keybindManager.registerAction('zoomOut', async () => {
    await dispatchReaderAction(READER_ACTION_COMMANDS.zoomOut());
  });

  keybindManager.registerAction('resetZoom', async () => {
    await dispatchReaderAction(READER_ACTION_COMMANDS.actualSize());
  });

  // Fit modes
  keybindManager.registerAction('fitToWidth', async () => {
    await dispatchReaderAction(READER_ACTION_COMMANDS.zoomToWidth());
  });

  keybindManager.registerAction('fitToPage', async () => {
    await dispatchReaderAction(READER_ACTION_COMMANDS.zoomToFit());
  });

  // Fullscreen
  keybindManager.registerAction('toggleFullscreen', toggleWindowFullScreen);

  keybindManager.registerAction('presentationMode', async () => {
    await togglePresentationMode();
  });

  debugLog('All keybind actions registered');
}
