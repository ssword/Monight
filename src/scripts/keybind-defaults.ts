// Default keyboard shortcuts, versioned so an upgrade can introduce new
// defaults without overriding the reader's own bindings.
//
// The Settings store keeps the whole keybind map, so a stored binding equal to
// the default of its time is indistinguishable from one the reader chose,
// unless the defaults of every earlier version are known. Each revision below
// lists only the actions whose default bindings changed in that version; the
// table is append-only (never edit a released revision).
//
// Adding a default (e.g. Back/Forward, Rotate): describe the action in
// KEYBIND_ACTIONS if it is new (a native menu command is
// `readerCommand(name, commandId)`, which also gives its menu item the
// binding as accelerator), then append a revision
//   { version: N + 1, binds: { GoBack: ['CmdOrCtrl+['], ... } }
// On upgrade, `migrateKeybinds` gives each listed action its new default only
// if the reader has not rebound it, and drops any new default that collides
// with a binding the reader chose. A default behind a gate (such as
// PAGE_ROTATION_VERIFIED) is appended in the change that opens the gate, so
// installs upgraded while it was closed still receive it.

import { sameChord } from './accelerators';

export type KeybindPlatform = 'mac' | 'other';

export interface KeybindConfig {
  displayName: string;
  binds: string[];
  action: string;
  data?: string;
}

export type Keybinds = Record<string, KeybindConfig>;

/** Bindings for every platform, or separate bindings for macOS and the others. */
type PlatformBinds =
  | readonly string[]
  | { readonly mac: readonly string[]; readonly other: readonly string[] };

interface KeybindDefaultsRevision {
  readonly version: number;
  readonly binds: Readonly<Record<string, PlatformBinds>>;
}

type KeybindAction = Omit<KeybindConfig, 'binds'>;

const readerCommand = (displayName: string, commandId: string): KeybindAction => ({
  displayName,
  action: 'readerCommand',
  data: commandId,
});

const switchToTab = (position: number): KeybindAction => ({
  displayName: position === 9 ? 'Switch to Last Tab' : `Switch to Tab ${position}`,
  action: 'switchToTab',
  data: String(position),
});

/** Every bindable action, in Settings order. Names here replace stored names. */
export const KEYBIND_ACTIONS: Readonly<Record<string, KeybindAction>> = {
  OpenFile: { displayName: 'Open PDF', action: 'openFile' },
  CloseTab: { displayName: 'Close Tab', action: 'closeTab' },
  ReopenTab: { displayName: 'Reopen Tab', action: 'reopenTab' },
  NextTab: { displayName: 'Next Tab', action: 'nextTab' },
  PreviousTab: { displayName: 'Previous Tab', action: 'previousTab' },
  Print: { displayName: 'Print', action: 'print' },
  Find: { displayName: 'Find in Document', action: 'find' },
  ZoomIn: { displayName: 'Zoom In', action: 'zoomIn' },
  ZoomOut: { displayName: 'Zoom Out', action: 'zoomOut' },
  ResetZoom: { displayName: 'Actual Size', action: 'resetZoom' },
  // Overridden with Cmd+, on macOS at runtime.
  Settings: { displayName: 'Open Settings', action: 'openSettings' },
  NextPage: { displayName: 'Next Page', action: 'nextPage' },
  PreviousPage: { displayName: 'Previous Page', action: 'previousPage' },
  FirstPage: { displayName: 'First Page', action: 'firstPage' },
  LastPage: { displayName: 'Last Page', action: 'lastPage' },
  GoToPage: readerCommand('Go to Page…', 'go.page'),
  FitToWidth: { displayName: 'Zoom to Width', action: 'fitToWidth' },
  FitToPage: { displayName: 'Zoom to Fit', action: 'fitToPage' },
  ViewContinuous: readerCommand('Continuous Scroll', 'view.mode.continuous'),
  ViewSinglePage: readerCommand('Single Page', 'view.mode.single'),
  ViewTwoPages: readerCommand('Two Pages', 'view.mode.spread'),
  SidebarHidden: readerCommand('Hide Sidebar', 'view.sidebar.hidden'),
  SidebarThumbnails: readerCommand('Thumbnails', 'view.sidebar.thumbnails'),
  SidebarTableOfContents: readerCommand('Table of Contents', 'view.sidebar.tableOfContents'),
  SidebarAnnotations: readerCommand('Highlights and Notes', 'view.sidebar.annotations'),
  MarkupToolbar: readerCommand('Show or Hide Markup Toolbar', 'view.markup-toolbar'),
  SwitchToTab1: switchToTab(1),
  SwitchToTab2: switchToTab(2),
  SwitchToTab3: switchToTab(3),
  SwitchToTab4: switchToTab(4),
  SwitchToTab5: switchToTab(5),
  SwitchToTab6: switchToTab(6),
  SwitchToTab7: switchToTab(7),
  SwitchToTab8: switchToTab(8),
  SwitchToTab9: switchToTab(9),
  Fullscreen: { displayName: 'Enter Full Screen', action: 'toggleFullscreen' },
  PresentationMode: { displayName: 'Slideshow', action: 'presentationMode' },
};

export const KEYBIND_DEFAULTS_REVISIONS: readonly KeybindDefaultsRevision[] = [
  {
    // The defaults every install had before Preview's shortcuts.
    version: 1,
    binds: {
      OpenFile: ['CmdOrCtrl+O'],
      CloseTab: ['CmdOrCtrl+W'],
      ReopenTab: ['CmdOrCtrl+Shift+T'],
      NextTab: ['CmdOrCtrl+Tab', 'CmdOrCtrl+PageDown'],
      PreviousTab: ['CmdOrCtrl+Shift+Tab', 'CmdOrCtrl+PageUp'],
      Print: ['CmdOrCtrl+P'],
      Find: ['CmdOrCtrl+F'],
      ZoomIn: ['CmdOrCtrl+=', 'CmdOrCtrl+Plus'],
      ZoomOut: ['CmdOrCtrl+-'],
      ResetZoom: ['CmdOrCtrl+0'],
      Settings: ['Alt+S'],
      NextPage: ['ArrowRight', 'ArrowDown'],
      PreviousPage: ['ArrowLeft', 'ArrowUp'],
      FirstPage: ['Home'],
      LastPage: ['End'],
      FitToWidth: ['CmdOrCtrl+Shift+W'],
      FitToPage: ['CmdOrCtrl+Shift+P'],
      SwitchToTab1: ['CmdOrCtrl+1'],
      SwitchToTab2: ['CmdOrCtrl+2'],
      SwitchToTab3: ['CmdOrCtrl+3'],
      SwitchToTab4: ['CmdOrCtrl+4'],
      SwitchToTab5: ['CmdOrCtrl+5'],
      SwitchToTab6: ['CmdOrCtrl+6'],
      SwitchToTab7: ['CmdOrCtrl+7'],
      SwitchToTab8: ['CmdOrCtrl+8'],
      SwitchToTab9: ['CmdOrCtrl+9'],
      Fullscreen: ['F11'],
      PresentationMode: ['Shift+F11'],
    },
  },
  {
    // Preview's shortcuts (#112). Switch to Tab N stays bindable without a default.
    version: 2,
    binds: {
      NextTab: { mac: ['Ctrl+Tab', 'Cmd+Shift+]'], other: ['Ctrl+Tab', 'Ctrl+PageDown'] },
      PreviousTab: {
        mac: ['Ctrl+Shift+Tab', 'Cmd+Shift+['],
        other: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
      },
      ViewContinuous: ['CmdOrCtrl+1'],
      ViewSinglePage: ['CmdOrCtrl+2'],
      ViewTwoPages: ['CmdOrCtrl+3'],
      FitToPage: ['CmdOrCtrl+9'],
      SidebarHidden: ['CmdOrCtrl+Alt+1'],
      SidebarThumbnails: ['CmdOrCtrl+Alt+2'],
      SidebarTableOfContents: ['CmdOrCtrl+Alt+3'],
      SidebarAnnotations: ['CmdOrCtrl+Alt+4'],
      MarkupToolbar: ['CmdOrCtrl+Shift+A'],
      GoToPage: ['CmdOrCtrl+Alt+G'],
      PresentationMode: ['CmdOrCtrl+Shift+F'],
      Fullscreen: { mac: ['Ctrl+Cmd+F'], other: ['F11'] },
      SwitchToTab1: [],
      SwitchToTab2: [],
      SwitchToTab3: [],
      SwitchToTab4: [],
      SwitchToTab5: [],
      SwitchToTab6: [],
      SwitchToTab7: [],
      SwitchToTab8: [],
      SwitchToTab9: [],
    },
  },
];

export const KEYBIND_DEFAULTS_VERSION = Math.max(
  ...KEYBIND_DEFAULTS_REVISIONS.map(({ version }) => version),
);

/** The keybind ids no longer offered; their stored bindings are ignored. */
export const RETIRED_KEYBIND_IDS: ReadonlySet<string> = new Set([
  // View-rotation shortcuts removed when rotation became a Page Rotation edit.
  'RotateClockwise',
  'RotateCounterClockwise',
]);

const forPlatform = (binds: PlatformBinds, platform: KeybindPlatform): string[] =>
  'mac' in binds ? [...binds[platform]] : [...binds];

/** Default bindings by action id as of `version`. */
function defaultBindsAt(version: number, platform: KeybindPlatform): Record<string, string[]> {
  const binds: Record<string, string[]> = {};
  for (const revision of KEYBIND_DEFAULTS_REVISIONS) {
    if (revision.version > version) continue;
    for (const [id, revisionBinds] of Object.entries(revision.binds)) {
      binds[id] = forPlatform(revisionBinds, platform);
    }
  }
  return binds;
}

const configFor = (id: string, binds: string[]): KeybindConfig => {
  const action = KEYBIND_ACTIONS[id];
  if (!action) throw new Error(`Keybind defaults name an unknown action: ${id}`);
  return { ...action, binds };
};

/** The current default keybinds for a platform. */
export function defaultKeybinds(platform: KeybindPlatform): Keybinds {
  const binds = defaultBindsAt(KEYBIND_DEFAULTS_VERSION, platform);
  return Object.fromEntries(
    Object.keys(KEYBIND_ACTIONS).map((id) => [id, configFor(id, binds[id] ?? [])]),
  );
}

/** The platform this window runs on, for platform-dependent defaults. */
export function currentKeybindPlatform(): KeybindPlatform {
  const platform = globalThis.navigator?.platform ?? '';
  return platform.toUpperCase().includes('MAC') ? 'mac' : 'other';
}

const sameBinds = (a: readonly string[], b: readonly string[], isMac: boolean): boolean =>
  a.length === b.length &&
  a.every((bind) => b.some((other) => sameChord(bind, other, isMac))) &&
  b.every((bind) => a.some((other) => sameChord(bind, other, isMac)));

/**
 * Applies every revision after `fromVersion` to a stored keybind map. An action
 * whose stored bindings still equal the defaults of the version it was stored
 * under (or that is not stored at all) takes the revision's defaults, minus any
 * chord another action keeps; every other action keeps the reader's bindings.
 * Every action a revision names is written out, so a dropped default stays
 * dropped instead of being merged back from the defaults.
 */
export function migrateKeybinds(
  stored: Keybinds,
  fromVersion: number,
  platform: KeybindPlatform,
): Keybinds {
  const isMac = platform === 'mac';
  let keybinds: Keybinds = Object.fromEntries(
    Object.entries(stored).filter(([id]) => !RETIRED_KEYBIND_IDS.has(id)),
  );
  const revisions = KEYBIND_DEFAULTS_REVISIONS.filter(({ version }) => version > fromVersion).sort(
    (a, b) => a.version - b.version,
  );
  for (const revision of revisions) {
    const previous = defaultBindsAt(revision.version - 1, platform);
    const takesDefault = new Set(
      Object.keys(revision.binds).filter((id) => {
        const current = keybinds[id];
        return current === undefined || sameBinds(current.binds, previous[id] ?? [], isMac);
      }),
    );
    const kept = Object.entries(keybinds)
      .filter(([id]) => !takesDefault.has(id))
      .flatMap(([, config]) => config.binds);
    keybinds = { ...keybinds };
    for (const id of takesDefault) {
      const binds = forPlatform(revision.binds[id], platform).filter(
        (bind) => !kept.some((keptBind) => sameChord(keptBind, bind, isMac)),
      );
      const current = keybinds[id];
      keybinds[id] = current ? { ...current, binds } : configFor(id, binds);
    }
  }
  return keybinds;
}

/**
 * The bindings in effect: stored bindings (stored under defaults `version`)
 * upgraded and laid over the current defaults, without retired actions, and
 * with each action's current name.
 */
export function effectiveKeybinds(
  stored: Keybinds | undefined,
  version: number,
  platform: KeybindPlatform,
): Keybinds {
  const keybinds = defaultKeybinds(platform);
  const upgraded = stored ? migrateKeybinds(stored, version, platform) : {};
  for (const [id, config] of Object.entries(upgraded)) {
    const displayName = KEYBIND_ACTIONS[id]?.displayName;
    keybinds[id] = displayName ? { ...config, displayName } : config;
  }
  return keybinds;
}
