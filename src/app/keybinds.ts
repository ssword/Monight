import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { debugLog } from '../lib/debug-log';
import type { DispatchReaderAction, ReadingSessionSnapshot } from '../reader/reader-actions';
import type { KeybindManager } from '../scripts/keybind-manager';
import { LEGACY_KEYBIND_COMMANDS } from './reader-commands';

interface KeybindContext {
  keybindManager: KeybindManager | null;
  getReadingSessionSnapshot: () => ReadingSessionSnapshot;
  getActivePageCount: () => Promise<number>;
  openPdfAndRefresh: () => Promise<void>;
  openSettings: () => Promise<void>;
  updateTabBarVisibility: () => void;
  updateUI: () => void;
  openSearch: () => void;
  goToPage: (page: number) => Promise<void>;
  /** Runs a native View, Go or Tools command (reader-commands.ts) by id. */
  runReaderCommand: (id: string) => Promise<boolean>;
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
  goToPage,
  runReaderCommand,
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

  // Zoom, page steps, Slideshow and full screen predate `readerCommand` but run
  // the same commands as the native menu.
  for (const [action, commandId] of Object.entries(LEGACY_KEYBIND_COMMANDS)) {
    keybindManager.registerAction(action, async () => {
      await runReaderCommand(commandId);
    });
  }

  // Shortcuts for Reader Commands (view modes, sidebar modes, markup
  // toolbar, Go to Page…) name the command in their data.
  keybindManager.registerAction('readerCommand', async (_e, commandId) => {
    if (commandId) await runReaderCommand(commandId);
  });

  debugLog('All keybind actions registered');
}
