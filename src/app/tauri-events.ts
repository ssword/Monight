import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ViewMode } from '../lib/document-features';
import type { FilterSettings } from '../scripts/filters';
import type { KeybindManager } from '../scripts/keybind-manager';
import type { SettingsManager } from '../scripts/settings';
import type { TabManager } from '../scripts/tabs';
import { openFiles } from './file-actions';
import { withActiveViewer } from './viewer-helpers';

interface TauriListenerContext {
  tabManager: TabManager | null;
  settingsManager: SettingsManager | null;
  keybindManager: KeybindManager | null;
  isMac: boolean;
  openPdfAndRefresh: () => Promise<void>;
  getInitialFilterSettings: () => FilterSettings;
  getInitialViewMode: () => ViewMode;
  reloadSettings: () => Promise<void>;
  applyWindowAfterOpen: () => Promise<void>;
  updateTabBarVisibility: () => void;
  updatePrintMenuState: () => Promise<void>;
  updateUI: () => void;
  saveCurrentTabState: () => void;
  printCurrentPDF: () => Promise<void>;
}

export async function setupTauriListeners({
  tabManager,
  settingsManager,
  keybindManager,
  isMac,
  openPdfAndRefresh,
  getInitialFilterSettings,
  getInitialViewMode,
  reloadSettings,
  applyWindowAfterOpen,
  updateTabBarVisibility,
  updatePrintMenuState,
  updateUI,
  saveCurrentTabState,
  printCurrentPDF,
}: TauriListenerContext): Promise<void> {
  const isSupportedFile = (path: string): boolean => {
    const ext = path.split('.').pop()?.toLowerCase();
    return ext === 'pdf';
  };

  const handleCliOpenPayload = async (payload: { files: string[]; page: number | null }) => {
    console.log('CLI open files event:', payload);
    if (!tabManager) return;

    const { files, page } = payload;

    try {
      const initialFilterSettings = getInitialFilterSettings();
      const initialViewMode = getInitialViewMode();
      // Open each file
      await openFiles(files, { tabManager, initialFilterSettings, initialViewMode });

      // Navigate to specific page if provided (applies to first/active tab)
      if (page && page > 0) {
        await withActiveViewer(tabManager, async (viewer) => {
          await viewer.goToPage(page);
          updateUI();
          console.log(`Navigated to page ${page}`);
        });
      }

      // Update UI
      updateTabBarVisibility();

      // Update print menu state
      await updatePrintMenuState();

      await applyWindowAfterOpen();
    } catch (error) {
      console.error('Error opening CLI files:', error);
      alert(`Failed to open files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleDroppedFiles = async (paths: string[]): Promise<void> => {
    console.log('File drop detected:', paths);
    if (!tabManager) return;

    const pdfFiles = paths.filter((path) => isSupportedFile(path));

    if (pdfFiles.length === 0) {
      alert('Please drop PDF files only.');
      return;
    }

    try {
      const initialFilterSettings = getInitialFilterSettings();
      const initialViewMode = getInitialViewMode();
      await openFiles(pdfFiles, {
        tabManager,
        continueOnError: true,
        onError: (message) => alert(message),
        initialFilterSettings,
        initialViewMode,
      });
    } catch (error) {
      console.error('Error opening dropped files:', error);
    }

    // Update UI
    updateTabBarVisibility();

    // Update print menu state
    await updatePrintMenuState();

    await applyWindowAfterOpen();
  };

  // Tauri 2 delivers a discriminated drag/drop payload through the current webview.
  await getCurrentWebview().onDragDropEvent(async (event) => {
    switch (event.payload.type) {
      case 'enter':
      case 'over':
        document.body.classList.add('drag-over');
        break;
      case 'drop':
        document.body.classList.remove('drag-over');
        await handleDroppedFiles(event.payload.paths);
        break;
      case 'leave':
        document.body.classList.remove('drag-over');
        break;
    }
  });

  // Listen for CLI file open events
  await listen<{ files: string[]; page: number | null }>('cli-open-files', async (event) => {
    await handleCliOpenPayload(event.payload);
  });

  // Pull any pending CLI payloads that were emitted before listeners were ready
  const pendingPayload = await invoke<{ files: string[]; page: number | null } | null>(
    'take_cli_payload',
  );
  if (pendingPayload?.files?.length) {
    await handleCliOpenPayload(pendingPayload);
  }

  // Listen for menu events
  await listen('menu-open', async () => {
    console.log('Menu open event received');
    await openPdfAndRefresh();
  });

  await listen('menu-print', async () => {
    console.log('Menu print event received');
    await printCurrentPDF();
  });

  await listen('menu-zoom-in', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.zoomIn();
      saveCurrentTabState();
      updateUI();
    });
  });

  await listen('menu-zoom-out', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.zoomOut();
      saveCurrentTabState();
      updateUI();
    });
  });

  await listen('menu-reset-zoom', async () => {
    await withActiveViewer(tabManager, async (viewer) => {
      await viewer.setZoom(1.0);
      saveCurrentTabState();
      updateUI();
    });
  });

  await listen('menu-toggle-fullscreen', async () => {
    console.log('Menu toggle fullscreen event received');
    const currentWindow = getCurrentWebviewWindow();
    const isFullscreen = await currentWindow.isFullscreen();
    await currentWindow.setFullscreen(!isFullscreen);
    console.log(`Fullscreen ${!isFullscreen ? 'enabled' : 'disabled'}`);
  });

  await listen('menu-close-tab', async () => {
    console.log('Menu close tab event received');
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      await tabManager?.closeTab(activeTab.id);
      updateTabBarVisibility();
    }
  });

  // Listen for keybinds changed event from settings window
  await listen('keybinds-changed', async () => {
    console.log('Keybinds changed event received, reloading keybinds...');
    if (settingsManager && keybindManager) {
      const settings = await settingsManager.load();
      // Override Settings keybind for macOS with Cmd+,
      if (isMac && settings.keybinds.Settings) {
        settings.keybinds.Settings.binds = ['Cmd+,'];
      }
      keybindManager.loadFromSettings(settings);
      console.log('Keybinds reloaded successfully');
    }
  });

  await listen('settings-changed', async () => {
    console.log('Settings changed event received, reloading settings...');
    await reloadSettings();
  });
}
