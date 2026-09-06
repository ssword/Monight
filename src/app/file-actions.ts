import { invoke } from '@tauri-apps/api/core';
import { debugLog } from '../lib/debug-log';
import type {
  DocumentIntake,
  DocumentIntakeOutcome,
  DocumentIntakeResult,
} from '../reader/document-intake';
import { showToast } from './dialogs';

interface IntakeFilesOptions {
  intake: DocumentIntake;
  page?: number;
  activate?: boolean;
}

interface OpenFilesOptions extends IntakeFilesOptions {
  continueOnError?: boolean;
  onError?: (message: string) => void;
}

interface EnsureViewingSizeOptions {
  fillAvailableHeight?: boolean;
}

export async function intakeFiles(
  filePaths: string[],
  { intake, page, activate = true }: IntakeFilesOptions,
): Promise<DocumentIntakeResult> {
  return intake.open(filePaths, {
    ...(page !== undefined ? { page } : {}),
    activate,
  });
}

function formatDocumentIntakeFailure(
  outcome: Extract<DocumentIntakeOutcome, { status: 'failed' }>,
): string {
  return `Failed to open ${outcome.requestedPath}: ${outcome.error instanceof Error ? outcome.error.message : 'Unknown error'}`;
}

export function reportDocumentIntakeOutcomes(
  result: DocumentIntakeResult,
  onError?: (message: string) => void,
): void {
  for (const outcome of result.outcomes) {
    if (outcome.status === 'opened') {
      debugLog(`Opened PDF: ${outcome.filePath}`);
      continue;
    }
    if (outcome.status === 'activated') {
      debugLog(`Document already open: ${outcome.filePath}`);
      continue;
    }
    const message = formatDocumentIntakeFailure(outcome);
    console.error(message, outcome.error);
    onError?.(message);
  }
}

export async function openFiles(
  filePaths: string[],
  { continueOnError = false, onError, ...intakeOptions }: OpenFilesOptions,
): Promise<number> {
  const result = await intakeFiles(filePaths, intakeOptions);
  reportDocumentIntakeOutcomes(result, onError);

  const firstFailure = result.outcomes.find(
    (outcome): outcome is Extract<DocumentIntakeOutcome, { status: 'failed' }> =>
      outcome.status === 'failed',
  );
  if (firstFailure && !continueOnError) throw firstFailure.error;

  return result.opened;
}

// Open PDF file dialog
export async function openPDFFile(intake: DocumentIntake | null): Promise<number> {
  if (!intake) return 0;
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
      intake,
      continueOnError: true,
      onError: (message) => showToast(message, 'error'),
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
export async function updatePrintMenuState(hasDocument: boolean): Promise<void> {
  try {
    await invoke('set_print_enabled', { enabled: hasDocument });
    debugLog(`Print menu ${hasDocument ? 'enabled' : 'disabled'}`);
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
