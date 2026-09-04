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
import { intakeFiles, reportDocumentIntakeOutcomes } from './file-actions';

export type ExternalOpenSource = 'commandLine' | 'operatingSystem' | 'dragAndDrop';

export interface ExternalOpenPayload {
  files: string[];
  page: number | null;
  source: ExternalOpenSource;
}

interface TauriListenerContext {
  tabManager: TabManager | null;
  settingsManager: SettingsManager | null;
  keybindManager: KeybindManager | null;
  isMac: boolean;
  openPdfAndRefresh: () => Promise<void>;
  getInitialFilterSettings: () => FilterSettings;
  getInitialViewMode: () => ViewMode;
  handleStartupExternalOpenPayloads: (payloads: readonly ExternalOpenPayload[]) => Promise<void>;
  reloadSettings: () => Promise<void>;
  readingHistoryCleared: () => void;
  applyWindowAfterOpen: () => Promise<void>;
  updateTabBarVisibility: () => void;
  updatePrintMenuState: () => Promise<void>;
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
  handleStartupExternalOpenPayloads,
  reloadSettings,
  readingHistoryCleared,
  applyWindowAfterOpen,
  updateTabBarVisibility,
  updatePrintMenuState,
  dispatchReaderAction,
}: TauriListenerContext): Promise<void> {
  const handleExternalOpenPayload = async (payload: ExternalOpenPayload) => {
    debugLog('External Document request:', payload);
    if (!tabManager) return;

    const { files, page } = payload;

    try {
      const initialFilterSettings = getInitialFilterSettings();
      const initialViewMode = getInitialViewMode();
      const result = await intakeFiles(files, {
        tabManager,
        initialFilterSettings,
        initialViewMode,
        ...(page && page > 0 ? { page } : {}),
      });
      reportDocumentIntakeOutcomes(result, (message) => showToast(message, 'error'));

      if (result.opened + result.activated > 0) {
        updateTabBarVisibility();
        await updatePrintMenuState();
        await applyWindowAfterOpen();
      }
    } catch (error) {
      console.error('External Document adapter failed:', error);
      showToast(
        `Failed to process Document request: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      );
    }
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
        debugLog('File drop detected:', event.payload.paths);
        await handleExternalOpenPayload({
          files: event.payload.paths,
          page: null,
          source: 'dragAndDrop',
        });
        break;
      case 'leave':
        document.body.classList.remove('drag-over');
        break;
    }
  });

  let releaseStartupGate!: () => void;
  const startupGate = new Promise<void>((resolve) => {
    releaseStartupGate = resolve;
  });
  let externalOpenDrain = Promise.resolve();
  const drainExternalOpenPayloads = (): Promise<void> => {
    externalOpenDrain = externalOpenDrain.then(async () => {
      await startupGate;
      while (true) {
        const payloads = await invoke<ExternalOpenPayload[]>('take_external_open_payloads');
        if (payloads.length === 0) return;
        for (const payload of payloads) {
          if (payload.files.length > 0) await handleExternalOpenPayload(payload);
        }
      }
    });
    return externalOpenDrain;
  };

  await listen('external-open-files-available', drainExternalOpenPayloads);
  const startupPayloads = await invoke<ExternalOpenPayload[]>('take_external_open_payloads');
  try {
    await handleStartupExternalOpenPayloads(startupPayloads);
  } finally {
    releaseStartupGate();
  }
  await drainExternalOpenPayloads();

  // Listen for menu events
  await listen('menu-open', async () => {
    debugLog('Menu open event received');
    await openPdfAndRefresh();
  });

  await listen('menu-print', async () => {
    debugLog('Menu print event received');
    await dispatchReaderAction({ type: 'printDocument' });
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
      await dispatchReaderAction({ type: 'closeDocument', filePath: activeTab.filePath });
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
