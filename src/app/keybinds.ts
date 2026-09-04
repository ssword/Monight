import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { debugLog } from '../lib/debug-log';
import { type DispatchReaderAction, readerAction } from '../reader/reader-actions';
import type { KeybindManager } from '../scripts/keybind-manager';
import type { TabManager } from '../scripts/tabs';
import { withActiveViewer } from './viewer-helpers';

interface KeybindContext {
  keybindManager: KeybindManager | null;
  tabManager: TabManager | null;
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
  tabManager,
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
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      await dispatchReaderAction({ type: 'closeDocument', filePath: activeTab.filePath });
      updateTabBarVisibility();
    }
  });

  keybindManager.registerAction('reopenTab', async () => {
    await dispatchReaderAction({ type: 'reopenLastClosedDocument' });
    updateTabBarVisibility();
  });

  keybindManager.registerAction('nextTab', async () => {
    await tabManager?.switchToNext();
  });

  keybindManager.registerAction('previousTab', async () => {
    await tabManager?.switchToPrevious();
  });

  keybindManager.registerAction('switchToTab', async (_e, data) => {
    const position = data ? parseInt(data, 10) : 1;
    await tabManager?.switchToPosition(position);
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
    await withActiveViewer(tabManager, async () => {
      await goToPage(1);
      updateUI();
    });
  });

  keybindManager.registerAction('lastPage', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await goToPage(viewer.getState().totalPages);
      updateUI();
    });
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
