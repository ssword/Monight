import type { MoonightSettings } from './settings';

/**
 * Parsed keybind structure for matching keyboard events
 */
export interface ParsedKeybind {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

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
  private actionHandlers: Map<string, KeybindAction> = new Map();
  private actionData: Map<string, string> = new Map();
  private isMac: boolean;

  constructor(isMac: boolean) {
    this.isMac = isMac;
  }

  /**
   * Parse an accelerator string into a ParsedKeybind
   * Examples: "CmdOrCtrl+O", "CmdOrCtrl+Shift+T", "F11"
   */
  parseAccelerator(accel: string): ParsedKeybind {
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
        case 'cmdorctrl':
          // Platform-aware: Cmd on Mac, Ctrl on Windows/Linux
          result.meta = this.isMac;
          result.ctrl = !this.isMac;
          break;
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
          // The actual key - normalize to lowercase for matching
          result.key = part.toLowerCase();
      }
    }

    return result;
  }

  /**
   * Register an action handler for a given action ID
   */
  registerAction(actionId: string, handler: KeybindAction, data?: string): void {
    this.actionHandlers.set(actionId, handler);
    if (data) {
      this.actionData.set(actionId, data);
    }
  }

  /**
   * Load keybinds from settings and build the lookup map
   */
  loadFromSettings(settings: MoonightSettings): void {
    this.keybinds.clear();

    for (const [actionId, config] of Object.entries(settings.keybinds)) {
      if (config.binds.length === 0) continue;

      const actionKey = config.action || actionId;
      const parsed: ParsedKeybind[] = config.binds.map((bind) =>
        this.parseAccelerator(bind)
      );

      this.keybinds.set(actionKey, parsed);

      // Store action data if present
      if (config.data) {
        this.actionData.set(actionKey, config.data);
      }
    }

    console.log(
      `KeybindManager loaded ${this.keybinds.size} actions with keybinds`
    );
  }

  /**
   * Match a keyboard event to a registered action
   * Returns the action ID or null if no match
   */
  matchEvent(e: KeyboardEvent): string | null {
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

    for (const [actionId, keybinds] of this.keybinds) {
      for (const kb of keybinds) {
        if (
          kb.key === eventKey &&
          kb.ctrl === e.ctrlKey &&
          kb.meta === e.metaKey &&
          kb.shift === e.shiftKey &&
          kb.alt === e.altKey
        ) {
          return actionId;
        }
      }
    }

    return null;
  }

  /**
   * Execute the action for a matched keyboard event
   */
  async handleEvent(e: KeyboardEvent): Promise<void> {
    const actionId = this.matchEvent(e);
    if (!actionId) return;

    const handler = this.actionHandlers.get(actionId);
    if (!handler) {
      console.warn(`No handler registered for action: ${actionId}`);
      return;
    }

    const data = this.actionData.get(actionId);
    await handler(e, data);
  }

  /**
   * Check if two keybinds match (for conflict detection)
   */
  keybindsMatch(a: ParsedKeybind, b: ParsedKeybind): boolean {
    return (
      a.key === b.key &&
      a.ctrl === b.ctrl &&
      a.meta === b.meta &&
      a.shift === b.shift &&
      a.alt === b.alt
    );
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
