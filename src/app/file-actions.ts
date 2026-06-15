import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { FilterSettings } from '../scripts/filters';
import type { TabManager } from '../scripts/tabs';
import { withActiveViewer } from './viewer-helpers';

interface OpenFilesOptions {
  tabManager: TabManager;
  continueOnError?: boolean;
  onError?: (message: string) => void;
  initialFilterSettings?: FilterSettings;
  initialViewMode?: 'single' | 'continuous';
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
        console.log(`File already open: ${canonicalPath}`);
        continue;
      }

      // Load PDF data
      const pdfData: number[] = await invoke('read_pdf_file', { path: canonicalPath });
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

      console.log(`Opened PDF: ${fileName}`);
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
  initialViewMode?: 'single' | 'continuous',
): Promise<number> {
  if (!tabManager) return 0;
  console.log('openPDFFile() called');
  try {
    console.log('Opening file dialog...');
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: 'Documents',
          extensions: ['pdf', 'xdp', 'fdf', 'xfdf'],
        },
      ],
    });

    console.log('File dialog result:', selected);

    if (!selected) {
      console.log('No file selected');
      return 0;
    }

    // Handle single or multiple files
    const files = Array.isArray(selected) ? selected : [selected];
    return await openFiles(files, { tabManager, initialFilterSettings, initialViewMode });
  } catch (error) {
    console.error('Error opening file:', error);
    alert(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return 0;
  }
}

// Update print menu state based on whether a PDF is loaded
export async function updatePrintMenuState(tabManager: TabManager | null): Promise<void> {
  const hasPDF = (tabManager?.size ?? 0) > 0;
  try {
    await invoke('set_print_enabled', { enabled: hasPDF });
    console.log(`Print menu ${hasPDF ? 'enabled' : 'disabled'}`);
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
    alert('No PDF is currently open.');
    return;
  }

  await withActiveViewer(tabManager, async (viewer) => {
    try {
      await viewer.print();
    } catch (error) {
      console.error('Print error:', error);
      alert(`Failed to print: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}

// Open settings window
export async function openSettings(): Promise<void> {
  try {
    await invoke('open_settings');
  } catch (error) {
    console.error('Error opening settings:', error);
    alert(`Failed to open settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
