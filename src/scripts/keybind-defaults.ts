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
// with a binding the reader chose.
//
// Gated defaults: an action behind a verification gate (KEYBIND_GATES, e.g.
// PAGE_ROTATION_VERIFIED for Rotate) is listed in GATED_KEYBIND_ACTIONS and
// introduced by a revision carrying the same `gate`. While the gate is closed
// the action and its revision do not exist: no default, no stored binding, not
// shown in Settings, and the revision does not count towards the stored
// defaults version. Opening the gate is the only change needed:
// - a fresh install gets the gated defaults with every other default;
// - an install stored under an earlier version applies the revision in order;
// - an install already stamped with a later version (upgraded while the gate
//   was closed) still applies the gated revision, because none of its actions
//   is stored yet. Collisions with the reader's own bindings are dropped as for
//   any revision. Once stored, a gated action is the reader's like any other.

import type { ReaderCommandId } from '../app/reader-commands';
import { isMacPlatform } from '../lib/platform';
import { PAGE_ROTATION_VERIFIED } from '../lib/verification-gates';
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

/** Verification gates that hide whole actions until their feature is verified. */
export interface KeybindGates {
  readonly pageRotation: boolean;
}

type KeybindGate = keyof KeybindGates;

/** The gates as this build ships them. */
export const KEYBIND_GATES: KeybindGates = Object.freeze({
  pageRotation: PAGE_ROTATION_VERIFIED,
});

interface KeybindDefaultsRevision {
  readonly version: number;
  /** A revision introducing gated actions applies only once the gate is open. */
  readonly gate?: KeybindGate;
  readonly binds: Readonly<Record<string, PlatformBinds>>;
}

type KeybindAction = Omit<KeybindConfig, 'binds'>;

const readerCommand = (displayName: string, commandId: ReaderCommandId): KeybindAction => ({
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
  Undo: readerCommand('Undo', 'edit.undo'),
  Redo: readerCommand('Redo', 'edit.redo'),
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
  GoBack: readerCommand('Back', 'go.back'),
  GoForward: readerCommand('Forward', 'go.forward'),
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
  RotateLeft: readerCommand('Rotate Left', 'tools.rotate.left'),
  RotateRight: readerCommand('Rotate Right', 'tools.rotate.right'),
};

/** Actions that exist only while their gate is open. */
const GATED_KEYBIND_ACTIONS: Readonly<Record<string, KeybindGate>> = {
  RotateLeft: 'pageRotation',
  RotateRight: 'pageRotation',
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
  {
    // Preview's Go ▸ Back and Forward through Navigation History (#113).
    version: 3,
    binds: {
      GoBack: ['CmdOrCtrl+['],
      GoForward: ['CmdOrCtrl+]'],
    },
  },
  {
    // Preview's Rotate Left and Rotate Right (#114), once Page Rotation is verified.
    version: 4,
    gate: 'pageRotation',
    binds: {
      RotateLeft: ['CmdOrCtrl+L'],
      RotateRight: ['CmdOrCtrl+R'],
    },
  },
  {
    // Edit ▸ Undo and Redo as Reader Actions (#99), replacing EmbedPDF's own shortcuts.
    version: 5,
    binds: {
      Undo: ['CmdOrCtrl+Z'],
      Redo: { mac: ['Cmd+Shift+Z'], other: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
    },
  },
];

const gateOpen = (gate: KeybindGate | undefined, gates: KeybindGates) =>
  gate === undefined || gates[gate];

const actionOffered = (id: string, gates: KeybindGates) =>
  gateOpen(GATED_KEYBIND_ACTIONS[id], gates);

const openRevisions = (gates: KeybindGates) =>
  KEYBIND_DEFAULTS_REVISIONS.filter(({ gate }) => gateOpen(gate, gates));

/** The defaults version stored keybinds are upgraded to: the latest open revision. */
export function keybindDefaultsVersion(gates: KeybindGates = KEYBIND_GATES): number {
  return Math.max(...openRevisions(gates).map(({ version }) => version));
}

/** The keybind ids no longer offered; their stored bindings are ignored. */
export const RETIRED_KEYBIND_IDS: ReadonlySet<string> = new Set([
  // View-rotation shortcuts removed when rotation became a Page Rotation edit.
  'RotateClockwise',
  'RotateCounterClockwise',
]);

const forPlatform = (binds: PlatformBinds, platform: KeybindPlatform): string[] =>
  'mac' in binds ? [...binds[platform]] : [...binds];

/** Default bindings by action id as of `version`, from the open revisions. */
function defaultBindsAt(
  version: number,
  platform: KeybindPlatform,
  gates: KeybindGates,
): Record<string, string[]> {
  const binds: Record<string, string[]> = {};
  for (const revision of openRevisions(gates)) {
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

/** The current default keybinds for a platform: every action whose gate is open. */
export function defaultKeybinds(
  platform: KeybindPlatform,
  gates: KeybindGates = KEYBIND_GATES,
): Keybinds {
  const binds = defaultBindsAt(keybindDefaultsVersion(gates), platform, gates);
  return Object.fromEntries(
    Object.keys(KEYBIND_ACTIONS)
      .filter((id) => actionOffered(id, gates))
      .map((id) => [id, configFor(id, binds[id] ?? [])]),
  );
}

/** The platform this window runs on, for platform-dependent defaults. */
export function currentKeybindPlatform(): KeybindPlatform {
  return isMacPlatform() ? 'mac' : 'other';
}

const sameBinds = (a: readonly string[], b: readonly string[], isMac: boolean): boolean =>
  a.length === b.length &&
  a.every((bind) => b.some((other) => sameChord(bind, other, isMac))) &&
  b.every((bind) => a.some((other) => sameChord(bind, other, isMac)));

/**
 * The open revisions a keybind map stored under `fromVersion` has not received:
 * every later one, and any gated one none of whose actions is stored yet (its
 * gate was closed when the map was upgraded past it).
 */
function pendingRevisions(
  stored: Keybinds | undefined,
  fromVersion: number,
  gates: KeybindGates,
): KeybindDefaultsRevision[] {
  return openRevisions(gates)
    .filter(
      ({ version, gate, binds }) =>
        version > fromVersion ||
        (gate !== undefined && Object.keys(binds).every((id) => stored?.[id] === undefined)),
    )
    .sort((a, b) => a.version - b.version);
}

/** Whether a stored keybind map lacks defaults it should be upgraded to. */
export function keybindsNeedUpgrade(
  stored: Keybinds | undefined,
  fromVersion: number,
  gates: KeybindGates = KEYBIND_GATES,
): boolean {
  if (fromVersion < keybindDefaultsVersion(gates)) return true;
  return stored !== undefined && pendingRevisions(stored, fromVersion, gates).length > 0;
}

/**
 * Applies every pending revision (see pendingRevisions) to a stored keybind
 * map. An action whose stored bindings still equal the defaults of the version
 * it was stored under (or that is not stored at all) takes the revision's
 * defaults, minus any chord another action keeps; every other action keeps the
 * reader's bindings. Every action a revision names is written out, so a dropped
 * default stays dropped instead of being merged back from the defaults. Retired
 * actions and actions behind a closed gate are left out.
 */
export function migrateKeybinds(
  stored: Keybinds,
  fromVersion: number,
  platform: KeybindPlatform,
  gates: KeybindGates = KEYBIND_GATES,
): Keybinds {
  const isMac = platform === 'mac';
  let keybinds: Keybinds = Object.fromEntries(
    Object.entries(stored).filter(
      ([id]) => !RETIRED_KEYBIND_IDS.has(id) && actionOffered(id, gates),
    ),
  );
  for (const revision of pendingRevisions(keybinds, fromVersion, gates)) {
    const previous = defaultBindsAt(revision.version - 1, platform, gates);
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
 * upgraded and laid over the current defaults, without retired or gated-off
 * actions, and with each action's current name.
 */
export function effectiveKeybinds(
  stored: Keybinds | undefined,
  version: number,
  platform: KeybindPlatform,
  gates: KeybindGates = KEYBIND_GATES,
): Keybinds {
  const keybinds = defaultKeybinds(platform, gates);
  const upgraded = stored ? migrateKeybinds(stored, version, platform, gates) : {};
  for (const [id, config] of Object.entries(upgraded)) {
    const displayName = KEYBIND_ACTIONS[id]?.displayName;
    keybinds[id] = displayName ? { ...config, displayName } : config;
  }
  return keybinds;
}
