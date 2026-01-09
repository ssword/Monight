import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-dialog';
import { LogicalSize } from '@tauri-apps/api/window';
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
      // Check if already open
      if (tabManager.isFileOpen(filePath)) {
        console.log(`File already open: ${filePath}`);
        continue;
      }

      // Load PDF data
      const pdfData: number[] = await invoke('read_pdf_file', { path: filePath });
      const fileName: string = await invoke('get_file_name', { path: filePath });

      // Create tab (TabManager handles viewer creation)
      await tabManager.createTab(
        filePath,
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
          name: 'PDF',
          extensions: ['pdf'],
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
export async function updatePrintMenuState(
  tabManager: TabManager | null,
): Promise<void> {
  const hasPDF = (tabManager?.size ?? 0) > 0;
  try {
    await invoke('set_print_enabled', { enabled: hasPDF });
    console.log(`Print menu ${hasPDF ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error('Failed to update print menu state:', error);
  }
}

// Ensure window is at minimum comfortable viewing size for PDFs
export async function ensureMinimumViewingSize(): Promise<void> {
  const currentWindow = getCurrentWebviewWindow();

  const size = await currentWindow.innerSize();
  const minWidth = 1000;
  const minHeight = 650;

  // Only resize if window is smaller than minimum
  if (size.width < minWidth || size.height < minHeight) {
    // Calculate new size, maintaining aspect ratio if needed
    const newWidth = Math.max(size.width, minWidth);
    const newHeight = Math.max(size.height, minHeight);

    await currentWindow.setSize(new LogicalSize(newWidth, newHeight));
    await currentWindow.center();
    console.log(`Window resized to ${newWidth}x${newHeight}`);
  }
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
