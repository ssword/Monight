import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { debugLog } from '../lib/debug-log';
import type { DocumentIntake } from '../reader/document-intake';
import type { DispatchReaderAction } from '../reader/reader-actions';
import { showToast } from './dialogs';
import { intakeFiles, reportDocumentIntakeOutcomes } from './file-actions';

export type ExternalOpenSource = 'commandLine' | 'operatingSystem' | 'dragAndDrop';

export interface ExternalOpenPayload {
  files: string[];
  page: number | null;
  source: ExternalOpenSource;
}

interface TauriListenerContext {
  intake: DocumentIntake | null;
  getActiveDocumentPath: () => string | null;
  /** Reloads the effective keybinds into shortcuts and menu accelerators. */
  reloadKeybinds: () => Promise<void>;
  openPdfAndRefresh: () => Promise<void>;
  handleStartupExternalOpenPayloads: (payloads: readonly ExternalOpenPayload[]) => Promise<void>;
  reloadSettings: () => Promise<void>;
  clearReadingHistory: () => Promise<void>;
  applyWindowAfterOpen: () => Promise<void>;
  updateTabBarVisibility: () => void;
  updatePrintMenuState: () => Promise<void>;
  dispatchReaderAction: DispatchReaderAction;
  /** Runs a native View, Go or Tools menu item; see reader-commands.ts. */
  runMenuCommand: (id: string) => Promise<boolean>;
}

export async function setupTauriListeners({
  intake,
  getActiveDocumentPath,
  reloadKeybinds,
  openPdfAndRefresh,
  handleStartupExternalOpenPayloads,
  reloadSettings,
  clearReadingHistory,
  applyWindowAfterOpen,
  updateTabBarVisibility,
  updatePrintMenuState,
  dispatchReaderAction,
  runMenuCommand,
}: TauriListenerContext): Promise<void> {
  const handleExternalOpenPayload = async (payload: ExternalOpenPayload) => {
    debugLog('External Document request:', payload);
    if (!intake) return;

    const { files, page } = payload;

    try {
      const result = await intakeFiles(files, {
        intake,
        ...(page && page > 0 ? { page } : {}),
      });
      reportDocumentIntakeOutcomes(result, (message) => showToast(message, 'error'));

      if (result.opened + result.activated > 0) {
        updateTabBarVisibility();
        await updatePrintMenuState();
        await applyWindowAfterOpen();
        const currentWindow = getCurrentWebviewWindow();
        await currentWindow.show();
        await currentWindow.unminimize();
        await currentWindow.setFocus();
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

  await listen('menu-save', async () => dispatchReaderAction({ type: 'saveDocument' }));
  await listen('menu-save-as', async () => dispatchReaderAction({ type: 'saveDocumentAs' }));

  await listen('menu-print', async () => {
    debugLog('Menu print event received');
    await dispatchReaderAction({ type: 'printDocument' });
  });

  // View, Go and Tools items arrive as reader command ids (reader-commands.ts).
  await listen<unknown>('menu-command', async (event) => {
    if (typeof event.payload === 'string') await runMenuCommand(event.payload);
  });

  await listen('menu-close-tab', async () => {
    debugLog('Menu close tab event received');
    const activeDocumentPath = getActiveDocumentPath();
    if (activeDocumentPath) {
      await dispatchReaderAction({ type: 'closeDocument', filePath: activeDocumentPath });
      updateTabBarVisibility();
    }
  });

  await listen('clear-reading-history', async () => {
    await clearReadingHistory();
  });

  // Listen for keybinds changed event from settings window
  await listen('keybinds-changed', async () => {
    debugLog('Keybinds changed event received, reloading keybinds...');
    await reloadKeybinds();
  });

  await listen('settings-changed', async () => {
    debugLog('Settings changed event received, reloading settings...');
    await reloadSettings();
  });
}
