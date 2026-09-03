import { invoke } from '@tauri-apps/api/core';
import { debugLog } from '../lib/debug-log';
import type { ViewMode } from '../lib/document-features';
import type { FilterSettings } from '../scripts/filters';
import type { TabManager } from '../scripts/tabs';
import { showToast } from './dialogs';
import { createDocumentIntakeRuntime } from './document-intake-runtime';
import { withActiveViewer } from './viewer-helpers';

interface OpenFilesOptions {
  tabManager: TabManager;
  continueOnError?: boolean;
  onError?: (message: string) => void;
  initialFilterSettings?: FilterSettings;
  initialViewMode?: ViewMode;
  page?: number;
  activate?: boolean;
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
    page,
    activate = true,
  }: OpenFilesOptions,
): Promise<number> {
  const intake = createDocumentIntakeRuntime({
    tabManager,
    initialFilterSettings,
    initialViewMode,
  });
  const result = await intake.open(filePaths, {
    ...(page !== undefined ? { page } : {}),
    activate,
  });

  for (const outcome of result.outcomes) {
    if (outcome.status === 'opened') {
      debugLog(`Opened PDF: ${outcome.filePath}`);
      continue;
    }
    if (outcome.status === 'activated') {
      debugLog(`Document already open: ${outcome.filePath}`);
      continue;
    }
    const message = `Failed to open ${outcome.requestedPath}: ${outcome.error instanceof Error ? outcome.error.message : 'Unknown error'}`;
    console.error(message, outcome.error);
    onError?.(message);
    if (!continueOnError) throw outcome.error;
  }

  return result.opened;
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

    return await openFiles(selected, {
      tabManager,
      continueOnError: true,
      onError: (message) => showToast(message, 'error'),
      initialFilterSettings,
      initialViewMode,
    });
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
