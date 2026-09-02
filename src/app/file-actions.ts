import { invoke } from '@tauri-apps/api/core';
import { debugLog } from '../lib/debug-log';
import type { ViewMode } from '../lib/document-features';
import type { FilterSettings } from '../scripts/filters';
import type { TabManager } from '../scripts/tabs';
import { showToast } from './dialogs';
import { withActiveViewer } from './viewer-helpers';

interface OpenFilesOptions {
  tabManager: TabManager;
  continueOnError?: boolean;
  onError?: (message: string) => void;
  initialFilterSettings?: FilterSettings;
  initialViewMode?: ViewMode;
}

interface EnsureViewingSizeOptions {
  fillAvailableHeight?: boolean;
}

export async function openFiles(
  filePaths: string[],
  {
    tabManager,
    continueOnError = false,
    onError,
    initialFilterSettings,
    initialViewMode,
  }: OpenFilesOptions,
): Promise<number> {
  let opened = 0;

  for (const filePath of filePaths) {
    try {
      const canonicalPath: string = await invoke('validate_open_path', { path: filePath });

      // Check if already open
      if (tabManager.isFileOpen(canonicalPath)) {
        debugLog(`File already open: ${canonicalPath}`);
        continue;
      }

      // Load PDF data (received as binary ArrayBuffer via Tauri's IPC)
      const pdfData: ArrayBuffer = await invoke('read_pdf_file', { path: canonicalPath });
      const fileName: string = await invoke('get_file_name', { path: canonicalPath });

      // Create tab (TabManager handles viewer creation)
      await tabManager.createTab(
        canonicalPath,
        fileName,
        new Uint8Array(pdfData),
        initialFilterSettings,
        initialViewMode ?? 'single',
      );
      opened += 1;

      debugLog(`Opened PDF: ${fileName}`);
    } catch (error) {
      const message = `Failed to open ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(message, error);
      if (onError) {
        onError(message);
      }
      if (!continueOnError) {
        throw error;
      }
    }
  }

  return opened;
}

// Open PDF file dialog
export async function openPDFFile(
  tabManager: TabManager | null,
  initialFilterSettings?: FilterSettings,
  initialViewMode?: ViewMode,
): Promise<number> {
  if (!tabManager) return 0;
  debugLog('openPDFFile() called');
  try {
    debugLog('Opening file dialog...');
    const selected = await invoke<string[]>('open_pdf_dialog');

    debugLog('File dialog result:', selected);

    if (!selected) {
      debugLog('No file selected');
      return 0;
    }

    return await openFiles(selected, { tabManager, initialFilterSettings, initialViewMode });
  } catch (error) {
    console.error('Error opening file:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (!message.includes('Password entry cancelled')) {
      showToast(`Failed to open file: ${message}`, 'error');
    }
    return 0;
  }
}

// Update print menu state based on whether a PDF is loaded
export async function updatePrintMenuState(tabManager: TabManager | null): Promise<void> {
  const hasPDF = (tabManager?.size ?? 0) > 0;
  try {
    await invoke('set_print_enabled', { enabled: hasPDF });
    debugLog(`Print menu ${hasPDF ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error('Failed to update print menu state:', error);
  }
}

// Ensure window is at minimum comfortable viewing size for PDFs
export async function ensureMinimumViewingSize({
  fillAvailableHeight = false,
}: EnsureViewingSizeOptions = {}): Promise<void> {
  await invoke('fit_main_window_for_pdf', { fillAvailableHeight });
}

// Print current PDF
export async function printCurrentPDF(tabManager: TabManager | null): Promise<void> {
  const activeTab = tabManager?.getActiveTab();
  if (!activeTab) {
    showToast('No PDF is currently open.', 'error');
    return;
  }

  await withActiveViewer(tabManager, async (viewer) => {
    try {
      await viewer.print();
    } catch (error) {
      console.error('Print error:', error);
      showToast(
        `Failed to print: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      );
    }
  });
}

// Open settings window
export async function openSettings(): Promise<void> {
  try {
    await invoke('open_settings');
  } catch (error) {
    console.error('Error opening settings:', error);
    showToast(
      `Failed to open settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'error',
    );
  }
}
