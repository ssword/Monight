import { acceleratorFromEvent } from './accelerators';

/**
 * KeybindEditor - UI component for capturing and editing keyboard shortcuts
 *
 * Provides a modal interface for users to press keys and create custom keybinds.
 */
export class KeybindEditor {
  private modal: HTMLElement | null = null;
  private isRecording: boolean = false;
  private capturedKeys: string[] = [];
  private onKeybindCaptured: ((keybind: string) => void) | null = null;
  private onCancel: (() => void) | null = null;
  constructor() {
    this.initializeModal();
  }

  /**
   * Initialize the modal element
   */
  private initializeModal(): void {
    // Check if modal already exists in DOM
    this.modal = document.getElementById('keybind-capture-modal');
    if (this.modal) {
      // Setup event listeners
      const cancelBtn = this.modal.querySelector('#cancel-keybind');
      const clearBtn = this.modal.querySelector('#clear-keybind');

      cancelBtn?.addEventListener('click', () => this.handleCancel());
      clearBtn?.addEventListener('click', () => this.handleClear());
    }
  }

  /**
   * Start recording a new keybind
   */
  startRecording(
    currentKeybind: string,
    onCapture: (keybind: string) => void,
    onCancel: () => void,
  ): void {
    this.onKeybindCaptured = onCapture;
    this.onCancel = onCancel;
    this.capturedKeys = [];
    this.isRecording = true;

    // Show modal
    this.showModal();

    // Display current keybind if any
    this.updateDisplay(currentKeybind);

    // Start listening for keyboard events
    window.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * Stop recording and hide modal
   */
  private stopRecording(save: boolean = true): void {
    this.isRecording = false;
    window.removeEventListener('keydown', this.handleKeyDown);

    if (save && this.capturedKeys.length > 0 && this.onKeybindCaptured) {
      const keybind = this.capturedKeys.join('+');
      this.onKeybindCaptured(keybind);
    }

    this.hideModal();
  }

  /**
   * Handle keyboard event during recording
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();

    // Escape cancels
    if (e.key === 'Escape') {
      this.handleCancel();
      return;
    }

    // Enter saves
    if (e.key === 'Enter') {
      this.stopRecording(true);
      return;
    }

    // Ignore modifier-only presses
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      this.buildCapturedKeys(e);
      this.updateDisplayFromEvent(e);
      return;
    }

    // Build the keybind from modifiers + key
    this.buildCapturedKeys(e);
    this.updateDisplayFromEvent(e);

    // Auto-save after a short delay when we have a complete keybind
    if (this.capturedKeys.length > 0) {
      setTimeout(() => {
        if (this.isRecording) {
          this.stopRecording(true);
        }
      }, 300);
    }
  };

  /**
   * Build captured keys array from keyboard event
   */
  private buildCapturedKeys(e: KeyboardEvent): void {
    this.capturedKeys = acceleratorFromEvent(e).split('+').filter(Boolean);
  }

  /**
   * Convert keyboard event to accelerator string
   */
  eventToAccelerator(e: KeyboardEvent): string {
    return acceleratorFromEvent(e);
  }

  /**
   * Update display from current captured keys
   */
  private updateDisplayFromEvent(_e: KeyboardEvent): void {
    const display = this.capturedKeys.join(' + ');
    this.updateDisplay(display);
  }

  /**
   * Update the display element
   */
  private updateDisplay(text: string): void {
    const displayEl = this.modal?.querySelector('#keybind-capture-display');
    if (displayEl) {
      displayEl.textContent = text || 'Press keys...';

      // Add visual feedback when recording
      if (this.isRecording && this.capturedKeys.length > 0) {
        displayEl.classList.add('recording');
      } else {
        displayEl.classList.remove('recording');
      }
    }
  }

  /**
   * Show the modal
   */
  private showModal(): void {
    if (this.modal) {
      this.modal.classList.remove('hidden');
    }
  }

  /**
   * Hide the modal
   */
  private hideModal(): void {
    if (this.modal) {
      this.modal.classList.add('hidden');
    }
  }

  /**
   * Handle cancel button click
   */
  private handleCancel(): void {
    this.stopRecording(false);
    if (this.onCancel) {
      this.onCancel();
    }
  }

  /**
   * Handle clear button click
   */
  private handleClear(): void {
    this.capturedKeys = [];
    this.updateDisplay('');
  }
}
