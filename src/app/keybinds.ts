import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { KeybindManager } from '../scripts/keybind-manager';
import type { TabManager } from '../scripts/tabs';
import { openFiles } from './file-actions';
import { withActiveViewer } from './viewer-helpers';

interface KeybindContext {
  keybindManager: KeybindManager | null;
  tabManager: TabManager | null;
  openPdfAndRefresh: () => Promise<void>;
  printCurrentPDF: () => Promise<void>;
  openSettings: () => Promise<void>;
  updateTabBarVisibility: () => void;
  saveCurrentTabState: () => void;
  updateUI: () => void;
}

// Register all keybind actions with the KeybindManager
export function registerKeybindActions({
  keybindManager,
  tabManager,
  openPdfAndRefresh,
  printCurrentPDF,
  openSettings,
  updateTabBarVisibility,
  saveCurrentTabState,
  updateUI,
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
    await printCurrentPDF();
  });

  keybindManager.registerAction('openSettings', async () => {
    await openSettings();
  });

  // Tab management
  keybindManager.registerAction('closeTab', async () => {
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      await tabManager?.closeTab(activeTab.id);
      updateTabBarVisibility();
    }
  });

  keybindManager.registerAction('reopenTab', async () => {
    if (!tabManager) return;
    const filePath = await tabManager.reopenLastClosed();
    if (filePath) {
      try {
        await openFiles([filePath], { tabManager });
        updateTabBarVisibility();
      } catch (error) {
        console.error('Error reopening tab:', error);
      }
    }
  });

  keybindManager.registerAction('nextTab', async () => {
    await tabManager?.switchToNext();
  });

  keybindManager.registerAction('previousTab', async () => {
    await tabManager?.switchToPrevious();
  });

  keybindManager.registerAction('switchToTab', async (_e, data) => {
    const position = data ? parseInt(data) : 1;
    await tabManager?.switchToPosition(position);
  });

  // PDF navigation (requires active tab)
  keybindManager.registerAction('nextPage', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.nextPage();
      saveCurrentTabState();
      updateUI();
    });
  });

  keybindManager.registerAction('previousPage', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.previousPage();
      saveCurrentTabState();
      updateUI();
    });
  });

  keybindManager.registerAction('firstPage', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.firstPage();
      saveCurrentTabState();
      updateUI();
    });
  });

  keybindManager.registerAction('lastPage', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.lastPage();
      saveCurrentTabState();
      updateUI();
    });
  });

  // Zoom
  keybindManager.registerAction('zoomIn', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.zoomIn();
      saveCurrentTabState();
      updateUI();
    });
  });

  keybindManager.registerAction('zoomOut', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.zoomOut();
      saveCurrentTabState();
      updateUI();
    });
  });

  keybindManager.registerAction('resetZoom', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.setZoom(1.0);
      saveCurrentTabState();
      updateUI();
    });
  });

  // Fit modes
  keybindManager.registerAction('fitToWidth', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.fitToWidth();
      saveCurrentTabState();
      updateUI();
    });
  });

  keybindManager.registerAction('fitToPage', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.fitToPage();
      saveCurrentTabState();
      updateUI();
    });
  });

  // Rotation
  keybindManager.registerAction('rotateRight', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.rotateClockwise();
      saveCurrentTabState();
      updateUI();
    });
  });

  keybindManager.registerAction('rotateLeft', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.rotateCounterClockwise();
      saveCurrentTabState();
      updateUI();
    });
  });

  // Fullscreen
  keybindManager.registerAction('toggleFullscreen', async () => {
    const currentWindow = getCurrentWebviewWindow();
    const isFullscreen = await currentWindow.isFullscreen();
    await currentWindow.setFullscreen(!isFullscreen);
  });

  console.log('All keybind actions registered');
}
