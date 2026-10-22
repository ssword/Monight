// Accelerator strings ("CmdOrCtrl+Shift+T", "Ctrl+Cmd+F", "F11") as stored in
// keybind settings and understood by the native menu.

/** The keys and modifiers an accelerator stands for on one platform. */
export interface ParsedKeybind {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export function parseAccelerator(accel: string, isMac: boolean): ParsedKeybind {
  const parts = accel.split('+').map((part) => part.trim().toLowerCase());
  const result: ParsedKeybind = { key: '', ctrl: false, meta: false, shift: false, alt: false };

  for (const part of parts) {
    switch (part) {
      case 'cmdorctrl':
        // Platform-aware: Cmd on Mac, Ctrl on Windows/Linux
        result.meta = isMac;
        result.ctrl = !isMac;
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
      case 'plus':
        result.key = '+';
        break;
      case 'minus':
        result.key = '-';
        break;
      default:
        result.key = part;
    }
  }

  return result;
}

export function keybindsMatch(a: ParsedKeybind, b: ParsedKeybind): boolean {
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.shift === b.shift &&
    a.alt === b.alt
  );
}

const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
};

/**
 * The unmodified key a KeyboardEvent.code names on a US layout ("Digit2" → "2",
 * "KeyG" → "g", "BracketRight" → "]"), or null for other keys.
 */
export function baseKeyFromCode(code: string | undefined): string | null {
  if (!code) return null;
  const letterOrDigit = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code);
  if (letterOrDigit) return (letterOrDigit[1] ?? letterOrDigit[2]).toLowerCase();
  return PUNCTUATION_CODES[code] ?? null;
}

const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta'];

/**
 * The accelerator a key press records in Settings ("Cmd+Alt+2"). Option and
 * Shift chords record the physical key, matching how they are matched.
 */
export function acceleratorFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Cmd');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  if (!MODIFIER_KEYS.includes(e.key)) {
    let key = (e.altKey || e.shiftKey ? baseKeyFromCode(e.code) : null) ?? e.key;
    if (key === ' ') key = 'Space';
    else if (key === '+') key = 'Plus';
    else if (key.length === 1) key = key.toUpperCase();
    parts.push(key);
  }

  return parts.join('+');
}

const MENU_NAMED_KEYS = new Set([
  'tab',
  'enter',
  'space',
  'escape',
  'backspace',
  'delete',
  'insert',
  'home',
  'end',
  'pageup',
  'pagedown',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
]);
const MENU_CHARACTER_KEYS = /^[a-z0-9[\]\-=,./\\;'`]$/;
const FUNCTION_KEY = /^f(?:[1-9]|1[0-9]|2[0-4])$/;

/**
 * The accelerator a native menu item shows for a binding, or null when the
 * menu cannot show it or must not claim it: a key without Ctrl, Cmd or Alt
 * (other than a function key) belongs to text fields and page scrolling, and
 * the native menu would take it from them on some platforms.
 */
export function menuAccelerator(bind: string): string | null {
  const { key, ctrl, meta, alt } = parseAccelerator(bind, false);
  if (FUNCTION_KEY.test(key)) return bind;
  if (!(ctrl || meta || alt)) return null;
  return MENU_CHARACTER_KEYS.test(key) || MENU_NAMED_KEYS.has(key) ? bind : null;
}

/** Whether two accelerators name the same chord on a platform, however written. */
export function sameChord(a: string, b: string, isMac: boolean): boolean {
  return keybindsMatch(parseAccelerator(a, isMac), parseAccelerator(b, isMac));
}
