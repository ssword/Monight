import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
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
  reloadSettings,
  applyWindowAfterOpen,
  updateTabBarVisibility,
  updatePrintMenuState,
  updateUI,
  saveCurrentTabState,
  printCurrentPDF,
}: TauriListenerContext): Promise<void> {
  // Listen for file drop events
  await listen<string[]>('tauri://file-drop', async (event) => {
    console.log('File drop detected:', event.payload);
    if (!tabManager) return;

    const pdfFiles = event.payload.filter((f) => f.toLowerCase().endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      alert('Please drop PDF files only.');
      return;
    }

    try {
      const initialFilterSettings = getInitialFilterSettings();
      await openFiles(pdfFiles, {
        tabManager,
        continueOnError: true,
        onError: (message) => alert(message),
        initialFilterSettings,
      });
    } catch (error) {
      console.error('Error opening dropped files:', error);
    }

    // Update UI
    updateTabBarVisibility();

    // Update print menu state
    await updatePrintMenuState();

    await applyWindowAfterOpen();
  });

  // Visual feedback for drag operations
  await listen('tauri://file-drop-hover', async () => {
    document.body.classList.add('drag-over');
  });

  await listen('tauri://file-drop-cancelled', async () => {
    document.body.classList.remove('drag-over');
  });

  // Listen for CLI file open events
  await listen<{ files: string[]; page: number | null }>(
    'cli-open-files',
    async (event) => {
      console.log('CLI open files event:', event.payload);
      if (!tabManager) return;

      const { files, page } = event.payload;

      try {
        const initialFilterSettings = getInitialFilterSettings();
        // Open each file
        await openFiles(files, { tabManager, initialFilterSettings });

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
        alert(
          `Failed to open files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    },
  );

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
