import { debugLog } from '../lib/debug-log';
import { isEditableTarget } from '../lib/editable-target';
import {
  baseKeyFromCode,
  keybindsMatch,
  type ParsedKeybind,
  parseAccelerator,
} from './accelerators';
import type { MoonightSettings } from './settings';

export type { ParsedKeybind } from './accelerators';

/**
 * Action handler type - can be sync or async
 */
type KeybindAction = (e: KeyboardEvent, data?: string) => void | Promise<void>;

/**
 * KeybindManager - Central module for handling all keyboard shortcuts
 *
 * Parses accelerator strings (e.g., "CmdOrCtrl+Shift+T") and matches
 * keyboard events to registered action handlers.
 */
export class KeybindManager {
  private keybinds: Map<string, ParsedKeybind[]> = new Map();
  private configuredActions: Map<string, string> = new Map();
  private actionHandlers: Map<string, KeybindAction> = new Map();
  private actionData: Map<string, string> = new Map();
  private registeredActionData: Map<string, string> = new Map();
  private isMac: boolean;

  constructor(isMac: boolean) {
    this.isMac = isMac;
  }

  /**
   * Parse an accelerator string into a ParsedKeybind
   * Examples: "CmdOrCtrl+O", "CmdOrCtrl+Shift+T", "F11"
   */
  parseAccelerator(accel: string): ParsedKeybind {
    return parseAccelerator(accel, this.isMac);
  }

  /**
   * Register an action handler for a given action ID
   */
  registerAction(actionId: string, handler: KeybindAction, data?: string): void {
    this.actionHandlers.set(actionId, handler);
    if (data) {
      this.registeredActionData.set(actionId, data);
    }
  }

  /**
   * Load keybinds from settings and build the lookup map
   */
  loadFromSettings(settings: MoonightSettings): void {
    this.keybinds.clear();
    this.configuredActions.clear();
    this.actionData.clear();

    for (const [bindingId, config] of Object.entries(settings.keybinds)) {
      if (config.binds.length === 0) continue;

      const parsed: ParsedKeybind[] = config.binds.map((bind) => this.parseAccelerator(bind));

      this.keybinds.set(bindingId, parsed);
      this.configuredActions.set(bindingId, config.action || bindingId);

      // Store action data if present
      if (config.data) {
        this.actionData.set(bindingId, config.data);
      }
    }

    debugLog(`KeybindManager loaded ${this.keybinds.size} actions with keybinds`);
  }

  /**
   * Match a keyboard event to a registered action
   * Returns the action ID or null if no match
   */
  matchEvent(e: KeyboardEvent): string | null {
    const bindingId = this.findMatchingBinding(e);
    if (!bindingId) return null;

    return this.configuredActions.get(bindingId) ?? bindingId;
  }

  private findMatchingBinding(e: KeyboardEvent): string | null {
    if (
      this.isEditableTarget(e.target) ||
      e.composedPath?.().some((target) => this.isEditableTarget(target))
    ) {
      return null;
    }

    const eventKey = e.key.toLowerCase();

    // Ignore modifier-only presses
    if (
      eventKey === 'control' ||
      eventKey === 'alt' ||
      eventKey === 'shift' ||
      eventKey === 'meta'
    ) {
      return null;
    }

    // Option and Shift change the character macOS reports (⌥⌘2 gives "™",
    // ⇧⌘] gives "}"), so those chords also match by the physical key.
    const physicalKey = e.altKey || e.shiftKey ? baseKeyFromCode(e.code) : null;
    for (const key of physicalKey && physicalKey !== eventKey
      ? [eventKey, physicalKey]
      : [eventKey]) {
      const bindingId = this.findBindingForKey(e, key);
      if (bindingId) return bindingId;
    }

    return null;
  }

  private findBindingForKey(e: KeyboardEvent, eventKey: string): string | null {
    for (const [bindingId, keybinds] of this.keybinds) {
      for (const kb of keybinds) {
        const shiftMatches = kb.shift === e.shiftKey || (kb.key === '+' && !kb.shift && e.shiftKey);
        if (
          kb.key === eventKey &&
          kb.ctrl === e.ctrlKey &&
          kb.meta === e.metaKey &&
          shiftMatches &&
          kb.alt === e.altKey
        ) {
          return bindingId;
        }
      }
    }

    return null;
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    return isEditableTarget(target);
  }

  /**
   * Execute the action for a matched keyboard event
   */
  async handleEvent(e: KeyboardEvent): Promise<void> {
    const bindingId = this.findMatchingBinding(e);
    if (!bindingId) return;

    const actionId = this.configuredActions.get(bindingId) ?? bindingId;
    const handler = this.actionHandlers.get(actionId);
    if (!handler) {
      console.warn(`No handler registered for action: ${actionId}`);
      return;
    }

    const data = this.actionData.get(bindingId) ?? this.registeredActionData.get(actionId);
    await handler(e, data);
  }

  /**
   * Check if two keybinds match (for conflict detection)
   */
  keybindsMatch(a: ParsedKeybind, b: ParsedKeybind): boolean {
    return keybindsMatch(a, b);
  }

  /**
   * Find which action uses a given keybind (for conflict detection)
   */
  findConflict(keybind: string, excludeAction?: string): string | null {
    const parsed = this.parseAccelerator(keybind);

    for (const [actionId, keybinds] of this.keybinds) {
      if (excludeAction && actionId === excludeAction) continue;

      for (const kb of keybinds) {
        if (this.keybindsMatch(parsed, kb)) {
          return actionId;
        }
      }
    }

    return null;
  }

  /**
   * Get all registered keybinds for display/debugging
   */
  getAllKeybinds(): Map<string, ParsedKeybind[]> {
    return this.keybinds;
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
}
