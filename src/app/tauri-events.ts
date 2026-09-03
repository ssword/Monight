import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { debugLog } from '../lib/debug-log';
import type { ViewMode } from '../lib/document-features';
import { type DispatchReaderAction, readerAction } from '../reader/reader-actions';
import type { FilterSettings } from '../scripts/filters';
import type { KeybindManager } from '../scripts/keybind-manager';
import type { SettingsManager } from '../scripts/settings';
import type { TabManager } from '../scripts/tabs';
import { showToast } from './dialogs';
import { openFiles } from './file-actions';

interface TauriListenerContext {
  tabManager: TabManager | null;
  settingsManager: SettingsManager | null;
  keybindManager: KeybindManager | null;
  isMac: boolean;
  openPdfAndRefresh: () => Promise<void>;
  getInitialFilterSettings: () => FilterSettings;
  getInitialViewMode: () => ViewMode;
  reportStartupIntent?: (payload: { files: string[]; page: number | null }) => void;
  reloadSettings: () => Promise<void>;
  readingHistoryCleared: () => void;
  applyWindowAfterOpen: () => Promise<void>;
  updateTabBarVisibility: () => void;
  updatePrintMenuState: () => Promise<void>;
  printCurrentPDF: () => Promise<void>;
  dispatchReaderAction: DispatchReaderAction;
}

export async function setupTauriListeners({
  tabManager,
  settingsManager,
  keybindManager,
  isMac,
  openPdfAndRefresh,
  getInitialFilterSettings,
  getInitialViewMode,
  reportStartupIntent,
  reloadSettings,
  readingHistoryCleared,
  applyWindowAfterOpen,
  updateTabBarVisibility,
  updatePrintMenuState,
  printCurrentPDF,
  dispatchReaderAction,
}: TauriListenerContext): Promise<void> {
  const isSupportedFile = (path: string): boolean => {
    const ext = path.split('.').pop()?.toLowerCase();
    return ext === 'pdf';
  };

  const handleCliOpenPayload = async (payload: { files: string[]; page: number | null }) => {
    debugLog('CLI open files event:', payload);
    if (!tabManager) return;

    const { files, page } = payload;
    reportStartupIntent?.(payload);

    try {
      const initialFilterSettings = getInitialFilterSettings();
      const initialViewMode = getInitialViewMode();
      // Open each file
      await openFiles(files, {
        tabManager,
        initialFilterSettings,
        initialViewMode,
        ...(page && page > 0 ? { page } : {}),
      });

      // Update UI
      updateTabBarVisibility();

      // Update print menu state
      await updatePrintMenuState();

      await applyWindowAfterOpen();
    } catch (error) {
      console.error('Error opening CLI files:', error);
      showToast(
        `Failed to open files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      );
    }
  };

  const handleDroppedFiles = async (paths: string[]): Promise<void> => {
    debugLog('File drop detected:', paths);
    if (!tabManager) return;

    const pdfFiles = paths.filter((path) => isSupportedFile(path));

    if (pdfFiles.length === 0) {
      showToast('Please drop PDF files only.', 'error');
      return;
    }

    try {
      const initialFilterSettings = getInitialFilterSettings();
      const initialViewMode = getInitialViewMode();
      await openFiles(pdfFiles, {
        tabManager,
        continueOnError: true,
        onError: (message) => showToast(message, 'error'),
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
    debugLog('Menu open event received');
    await openPdfAndRefresh();
  });

  await listen('menu-print', async () => {
    debugLog('Menu print event received');
    await printCurrentPDF();
  });

  await listen('menu-zoom-in', async () => {
    await dispatchReaderAction(readerAction.zoomIn());
  });

  await listen('menu-zoom-out', async () => {
    await dispatchReaderAction(readerAction.zoomOut());
  });

  await listen('menu-reset-zoom', async () => {
    await dispatchReaderAction(readerAction.setZoomIntent({ kind: 'manual', scale: 1 }));
  });

  await listen('menu-toggle-fullscreen', async () => {
    debugLog('Menu toggle fullscreen event received');
    const currentWindow = getCurrentWebviewWindow();
    const isFullscreen = await currentWindow.isFullscreen();
    await currentWindow.setFullscreen(!isFullscreen);
    debugLog(`Fullscreen ${!isFullscreen ? 'enabled' : 'disabled'}`);
  });

  await listen('menu-close-tab', async () => {
    debugLog('Menu close tab event received');
    const activeTab = tabManager?.getActiveTab();
    if (activeTab) {
      await tabManager?.closeTab(activeTab.id);
      updateTabBarVisibility();
    }
  });

  await listen('clear-reading-history', async () => {
    if (!settingsManager) return;
    await settingsManager.clearReadingHistory();
    readingHistoryCleared();
  });

  // Listen for keybinds changed event from settings window
  await listen('keybinds-changed', async () => {
    debugLog('Keybinds changed event received, reloading keybinds...');
    if (settingsManager && keybindManager) {
      const settings = await settingsManager.load();
      // Override Settings keybind for macOS with Cmd+,
      if (isMac && settings.keybinds.Settings) {
        settings.keybinds.Settings.binds = ['Cmd+,'];
      }
      keybindManager.loadFromSettings(settings);
      debugLog('Keybinds reloaded successfully');
    }
  });

  await listen('settings-changed', async () => {
    debugLog('Settings changed event received, reloading settings...');
    await reloadSettings();
  });
}
