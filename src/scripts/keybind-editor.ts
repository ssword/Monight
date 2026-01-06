import type { MoonightSettings } from './settings';
import type { KeybindManager, ParsedKeybind } from './keybind-manager';

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
  private keybindManager: KeybindManager | null = null;
  private currentSettings: MoonightSettings | null = null;
  private isMac: boolean;

  constructor(keybindManager: KeybindManager, settings: MoonightSettings, isMac: boolean) {
    this.keybindManager = keybindManager;
    this.currentSettings = settings;
    this.isMac = isMac;
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
    onCancel: () => void
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
    this.capturedKeys = [];

    if (e.ctrlKey) {
      this.capturedKeys.push('Ctrl');
    }
    if (e.metaKey) {
      this.capturedKeys.push('Cmd');
    }
    if (e.shiftKey) {
      this.capturedKeys.push('Shift');
    }
    if (e.altKey) {
      this.capturedKeys.push('Alt');
    }

    // Add the main key (not modifiers)
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      let key = e.key;

      // Handle special keys
      if (key === ' ') {
        key = 'Space';
      } else if (key.length === 1) {
        // Single character - uppercase for letters
        key = key.toUpperCase();
      }

      this.capturedKeys.push(key);
    }
  }

  /**
   * Convert keyboard event to accelerator string
   */
  eventToAccelerator(e: KeyboardEvent): string {
    const parts: string[] = [];

    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Cmd');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      let key = e.key;
      if (key === ' ') {
        key = 'Space';
      } else if (key.length === 1) {
        key = key.toUpperCase();
      }
      parts.push(key);
    }

    return parts.join('+');
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

  /**
   * Validate keybind - check for conflicts
   */
  validateKeybind(keybind: string, excludeAction?: string): boolean {
    if (!keybind || !this.keybindManager || !this.currentSettings) {
      return true;
    }

    // Parse the keybind
    const parsed = this.parseAccelerator(keybind);

    // Check against all existing keybinds
    for (const [actionId, config] of Object.entries(this.currentSettings.keybinds)) {
      if (excludeAction && actionId === excludeAction) continue;

      for (const bind of config.binds) {
        const existingParsed = this.parseAccelerator(bind);
        if (this.keybindsMatch(parsed, existingParsed)) {
          return false; // Conflict found
        }
      }
    }

    return true; // No conflicts
  }

  /**
   * Parse accelerator string into ParsedKeybind
   */
  private parseAccelerator(accel: string): ParsedKeybind {
    const parts = accel.split('+').map((p) => p.trim().toLowerCase());
    const result: ParsedKeybind = {
      key: '',
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
    };

    for (const part of parts) {
      switch (part) {
        case 'ctrl':
        case 'control':
          result.ctrl = true;
          break;
        case 'meta':
        case 'cmd':
        case 'command':
          result.meta = true;
          break;
        case 'shift':
          result.shift = true;
          break;
        case 'alt':
        case 'option':
          result.alt = true;
          break;
        default:
          result.key = part.toLowerCase();
      }
    }

    return result;
  }

  /**
   * Check if two keybinds match
   */
  private keybindsMatch(a: ParsedKeybind, b: ParsedKeybind): boolean {
    return (
      a.key === b.key &&
      a.ctrl === b.ctrl &&
      a.meta === b.meta &&
      a.shift === b.shift &&
      a.alt === b.alt
    );
  }

  /**
   * Format keybind for platform-specific display
   */
  formatForDisplay(keybind: string): string {
    return keybind
      .replace('CmdOrCtrl', this.isMac ? 'Cmd' : 'Ctrl')
      .replace(/\+/g, ' + ')
      .replace('Plus', '+')
      .replace('Minus', '-')
      .replace('ArrowRight', '→')
      .replace('ArrowLeft', '←')
      .replace('ArrowUp', '↑')
      .replace('ArrowDown', '↓');
  }

  /**
   * Find conflicting action for a keybind
   */
  findConflict(keybind: string, excludeAction?: string): { actionId: string; displayName: string } | null {
    if (!keybind || !this.currentSettings) return null;

    for (const [actionId, config] of Object.entries(this.currentSettings.keybinds)) {
      if (excludeAction && actionId === excludeAction) continue;

      if (config.binds.includes(keybind)) {
        return { actionId, displayName: config.displayName };
      }
    }

    return null;
  }
}
