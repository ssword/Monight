// Reader commands: the one table behind the native View, Go and Tools menus.
// Each command names the typed Reader Action or chrome-preference change its
// toolbar control makes (or calls that control's own entry point), and how its
// menu item's enabled, checked and title state follows the reader.
//
// Command ids are the native menu item ids (src-tauri/src/menu.rs). Rust
// forwards every `view.*`, `go.*` and `tools.*` click as a `menu-command`
// event; `readerCommandStates` feeds `set_menu_item_states` and
// `readerMenuSubmenus` fills the menus built from TypeScript lists.
//
// Extending: add an entry to `staticCommands` (and the item in menu.rs), or
// extend `ReaderCommandStateInput` for new reader state.
//
// Rotate Left and Rotate Right exist only while PAGE_ROTATION_VERIFIED is on:
// otherwise they are neither commands nor menu items (the `tools.rotate`
// section stays empty), so no shortcut or menu click can reach them.

import type { ViewMode } from '../lib/document-features';
import { PAGE_ROTATION_VERIFIED } from '../lib/verification-gates';
import {
  type DispatchReaderAction,
  type ReaderAction,
  readerAction,
} from '../reader/reader-actions';
import { menuAccelerator } from '../scripts/accelerators';
import {
  APPEARANCE_PRESETS,
  type AppearancePresetId,
  type FilterSettings,
  presetForFilterSettings,
} from '../scripts/filters';
import type { KeybindConfig } from '../scripts/keybind-defaults';
import type { ChromePreferences, ChromePreferencesAuthority } from './chrome-preferences';
import type { ActiveMarkupState } from './document-workspace';
import { VERIFIED_MARKUP_TOOLS, type VerifiedMarkupTool } from './markup-tools';
import type { SidebarChoice } from './reader-sidebar';
import { tabBarShown } from './tab-bar';

/**
 * Reader Actions shared by every input adapter (toolbar, shortcuts, menus) so
 * each command maps to its typed action in one place.
 */
export const READER_ACTION_COMMANDS = {
  zoomIn: () => readerAction.zoomIn(),
  zoomOut: () => readerAction.zoomOut(),
  actualSize: () => readerAction.setZoomIntent({ kind: 'manual', scale: 1 }),
  zoomToFit: () => readerAction.setZoomIntent({ kind: 'fit-page' }),
  zoomToWidth: () => readerAction.setZoomIntent({ kind: 'fit-width' }),
  previousPage: (): ReaderAction => ({ type: 'goToPreviousPage' }),
  nextPage: (): ReaderAction => ({ type: 'goToNextPage' }),
  back: (): ReaderAction => ({ type: 'goBack' }),
  forward: (): ReaderAction => ({ type: 'goForward' }),
} as const;

export interface ReaderCommandContext {
  readonly dispatchReaderAction: DispatchReaderAction;
  readonly preferences: ChromePreferencesAuthority;
  /** The toolbar sidebar menu's own choice handler. */
  readonly sidebar: { choose(choice: SidebarChoice): void } | null;
  /** The markup toolbar's own Markup toggle and tool buttons. */
  readonly markupToolbar: { toggle(): void; chooseTool(toolId: string): void } | null;
  /** The Highlight split button's own click, for its text-markup tools. */
  readonly highlightButton: { activate(toolId: string): void } | null;
  /** The Appearance popover's own preset handler (Custom opens the sliders). */
  readonly appearance: { choose(preset: AppearancePresetId): void } | null;
  /** Returns to text selection (Tools ▸ Text Selection). */
  readonly setActiveTool: (toolId: null) => void;
  readonly toggleSlideshow: () => Promise<void>;
  readonly toggleFullScreen: () => Promise<void>;
  /** Asks the reader for a page number; null when cancelled. */
  readonly requestPage: () => Promise<number | null>;
  /** The pages selected in the Thumbnails sidebar (transient); empty when none. */
  readonly selectedPages: () => readonly number[];
  /** The active Document's current page; null without one. */
  readonly currentPage: () => number | null;
  /** View ▸ Show/Hide Tab Bar: keeps the tab bar shown for one Document, for this app run. */
  readonly toggleTabBar: () => void;
}

export interface ReaderCommandStateInput {
  readonly documentCount: number;
  readonly activeDocument: {
    readonly viewMode: ViewMode;
    readonly filterSettings: FilterSettings;
    readonly currentPage: number;
    readonly pageCount: number;
  } | null;
  readonly preferences: ChromePreferences;
  readonly markup: ActiveMarkupState | null;
  readonly fullScreen: boolean;
  /** Whether the active Document's Navigation History has somewhere to go. */
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** Whether View ▸ Show Tab Bar keeps the tab bar shown (transient, never persisted). */
  readonly tabBarKeptShown: boolean;
  /**
   * The effective keybinds; each command's menu item shows its shortcut as
   * its accelerator. Absent: accelerators are left as they are.
   */
  readonly keybinds?: Readonly<Record<string, Pick<KeybindConfig, 'binds' | 'action' | 'data'>>>;
}

/** One native menu item's state; `text` is set only for items whose title changes. */
export interface ReaderCommandState {
  readonly id: string;
  readonly enabled: boolean;
  readonly checked?: boolean;
  readonly text?: string;
  /** The shortcut shown beside the item; null shows none. */
  readonly accelerator?: string | null;
}

/** A native submenu whose items come from a TypeScript list. */
export interface ReaderMenuSubmenu {
  readonly id: string;
  readonly items: readonly { readonly id: string; readonly text: string }[];
}

interface ReaderCommand {
  readonly id: string;
  run(context: ReaderCommandContext): void | Promise<void>;
  state(input: ReaderCommandStateInput): Omit<ReaderCommandState, 'id'>;
}

const APPEARANCE_SUBMENU = 'view.appearance';
const ANNOTATE_SUBMENU = 'tools.annotate';
/** The Tools menu's Rotate items, listed inline from TypeScript behind the gate. */
const ROTATE_SECTION = 'tools.rotate';

const ROTATE_ITEMS = [
  { id: `${ROTATE_SECTION}.left`, text: 'Rotate Left', direction: 'counterclockwise' },
  { id: `${ROTATE_SECTION}.right`, text: 'Rotate Right', direction: 'clockwise' },
] as const;

const hasDocument = (input: ReaderCommandStateInput) => input.activeDocument !== null;
const whenDocument = (input: ReaderCommandStateInput) => ({ enabled: hasDocument(input) });
const checkedWithDocument = (input: ReaderCommandStateInput, checked: boolean) => ({
  enabled: hasDocument(input),
  checked: hasDocument(input) && checked,
});

const dispatching = (id: string, action: () => ReaderAction): ReaderCommand => ({
  id,
  run: (context) => context.dispatchReaderAction(action()),
  state: whenDocument,
});

const sidebarCommand = (choice: SidebarChoice): ReaderCommand => ({
  id: `view.sidebar.${choice}`,
  run: (context) => context.sidebar?.choose(choice),
  state: (input) => {
    const { sidebarVisible, sidebarMode } = input.preferences;
    return checkedWithDocument(
      input,
      choice === 'hidden' ? !sidebarVisible : sidebarVisible && sidebarMode === choice,
    );
  },
});

const viewModeCommand = (viewMode: ViewMode): ReaderCommand => ({
  id: `view.mode.${viewMode}`,
  run: (context) => context.dispatchReaderAction(readerAction.setViewMode(viewMode)),
  state: (input) => checkedWithDocument(input, input.activeDocument?.viewMode === viewMode),
});

const staticCommands: readonly ReaderCommand[] = [
  {
    id: 'view.tab-bar',
    run: (context) => context.toggleTabBar(),
    state: (input) => {
      const shown = tabBarShown(input.documentCount, input.tabBarKeptShown);
      return {
        // Several open Documents always show their tabs.
        enabled: hasDocument(input) && input.documentCount < 2,
        text: shown ? 'Hide Tab Bar' : 'Show Tab Bar',
      };
    },
  },
  sidebarCommand('hidden'),
  sidebarCommand('thumbnails'),
  sidebarCommand('tableOfContents'),
  sidebarCommand('annotations'),
  viewModeCommand('continuous'),
  viewModeCommand('single'),
  viewModeCommand('spread'),
  dispatching('view.zoom.actual-size', READER_ACTION_COMMANDS.actualSize),
  dispatching('view.zoom.fit', READER_ACTION_COMMANDS.zoomToFit),
  dispatching('view.zoom.width', READER_ACTION_COMMANDS.zoomToWidth),
  dispatching('view.zoom.in', READER_ACTION_COMMANDS.zoomIn),
  dispatching('view.zoom.out', READER_ACTION_COMMANDS.zoomOut),
  {
    id: 'view.markup-toolbar',
    run: (context) => context.markupToolbar?.toggle(),
    state: (input) => ({
      enabled: hasDocument(input),
      text: input.preferences.markupToolbarVisible ? 'Hide Markup Toolbar' : 'Show Markup Toolbar',
    }),
  },
  {
    id: 'view.slideshow',
    run: (context) => context.toggleSlideshow(),
    state: whenDocument,
  },
  {
    id: 'view.full-screen',
    run: (context) => context.toggleFullScreen(),
    state: (input) => ({
      enabled: true,
      text: input.fullScreen ? 'Exit Full Screen' : 'Enter Full Screen',
    }),
  },
  {
    id: 'go.previous-page',
    run: (context) => context.dispatchReaderAction(READER_ACTION_COMMANDS.previousPage()),
    state: (input) => ({ enabled: (input.activeDocument?.currentPage ?? 0) > 1 }),
  },
  {
    id: 'go.next-page',
    run: (context) => context.dispatchReaderAction(READER_ACTION_COMMANDS.nextPage()),
    state: ({ activeDocument }) => ({
      enabled: activeDocument !== null && activeDocument.currentPage < activeDocument.pageCount,
    }),
  },
  {
    id: 'go.page',
    run: async (context) => {
      const page = await context.requestPage();
      // Unlike thumbnails and surface navigation, Go to Page… is a recorded jump.
      if (page !== null) {
        await context.dispatchReaderAction({ type: 'goToPage', page, recordHistory: true });
      }
    },
    state: whenDocument,
  },
  {
    id: 'go.back',
    run: (context) => context.dispatchReaderAction(READER_ACTION_COMMANDS.back()),
    state: (input) => ({ enabled: hasDocument(input) && input.canGoBack }),
  },
  {
    id: 'go.forward',
    run: (context) => context.dispatchReaderAction(READER_ACTION_COMMANDS.forward()),
    state: (input) => ({ enabled: hasDocument(input) && input.canGoForward }),
  },
  {
    id: 'tools.text-selection',
    run: (context) => context.setActiveTool(null),
    state: (input) =>
      checkedWithDocument(input, input.markup !== null && input.markup.activeToolId === null),
  },
];

const appearanceCommands = (): ReaderCommand[] =>
  APPEARANCE_PRESETS.map(({ id }) => ({
    id: `${APPEARANCE_SUBMENU}.${id}`,
    run: (context) => context.appearance?.choose(id),
    state: (input) =>
      checkedWithDocument(
        input,
        input.activeDocument !== null &&
          presetForFilterSettings(input.activeDocument.filterSettings) === id,
      ),
  }));

const annotateCommands = (tools: readonly VerifiedMarkupTool[]): ReaderCommand[] =>
  tools.map((tool) => ({
    id: `${ANNOTATE_SUBMENU}.${tool.id}`,
    // Each tool behaves as in the control that offers it; protected Documents
    // are refused there.
    run: (context) =>
      tool.control === 'highlight-menu'
        ? context.highlightButton?.activate(tool.id)
        : context.markupToolbar?.chooseTool(tool.id),
    state: (input) => ({
      enabled: hasDocument(input) && input.markup !== null && input.markup.readOnlyReason === null,
      checked: hasDocument(input) && input.markup?.activeToolId === tool.id,
    }),
  }));

/**
 * Page Rotation acts on the pages selected in the Thumbnails sidebar, or on the
 * current page when none are; protected Documents are refused with their
 * explanation by the Reader Action.
 */
const rotateCommands = (): ReaderCommand[] =>
  ROTATE_ITEMS.map(({ id, direction }) => ({
    id,
    run: (context) => {
      const selected = context.selectedPages();
      const current = context.currentPage();
      const pages = selected.length > 0 ? [...selected] : current ? [current] : [];
      if (pages.length === 0) return;
      return context.dispatchReaderAction(readerAction.rotatePages(pages, direction));
    },
    state: (input) => ({
      enabled: hasDocument(input) && input.markup !== null && input.markup.readOnlyReason === null,
    }),
  }));

function readerCommands(
  tools: readonly VerifiedMarkupTool[],
  pageRotation: boolean,
): readonly ReaderCommand[] {
  const commands = [...staticCommands, ...(pageRotation ? rotateCommands() : [])];
  const textSelection = commands.findIndex(({ id }) => id === 'tools.text-selection');
  const zoomOut = commands.findIndex(({ id }) => id === 'view.zoom.out');
  // Menu order: presets after the markup toolbar item, tools after Text Selection.
  commands.splice(textSelection + 1, 0, ...annotateCommands(tools));
  commands.splice(zoomOut + 2, 0, ...appearanceCommands());
  return commands;
}

/** Runs a native menu command; false when the id names no command. */
export async function runReaderCommand(
  id: string,
  context: ReaderCommandContext,
  tools: readonly VerifiedMarkupTool[] = VERIFIED_MARKUP_TOOLS,
  pageRotation: boolean = PAGE_ROTATION_VERIFIED,
): Promise<boolean> {
  const command = readerCommands(tools, pageRotation).find((candidate) => candidate.id === id);
  if (!command) return false;
  await command.run(context);
  return true;
}

/**
 * Keybind actions that predate the `readerCommand` action, and the menu
 * command each one performs.
 */
const KEYBIND_ACTION_COMMANDS: Readonly<Record<string, string>> = {
  resetZoom: 'view.zoom.actual-size',
  fitToPage: 'view.zoom.fit',
  fitToWidth: 'view.zoom.width',
  zoomIn: 'view.zoom.in',
  zoomOut: 'view.zoom.out',
  presentationMode: 'view.slideshow',
  toggleFullscreen: 'view.full-screen',
  previousPage: 'go.previous-page',
  nextPage: 'go.next-page',
};

/** Each command's menu accelerator: its first binding the native menu can show. */
function commandAccelerators(
  keybinds: NonNullable<ReaderCommandStateInput['keybinds']>,
): Map<string, string> {
  const accelerators = new Map<string, string>();
  for (const { action, data, binds } of Object.values(keybinds)) {
    const commandId = action === 'readerCommand' ? data : KEYBIND_ACTION_COMMANDS[action];
    if (!commandId || accelerators.has(commandId)) continue;
    const accelerator = binds.map(menuAccelerator).find((candidate) => candidate !== null);
    if (accelerator) accelerators.set(commandId, accelerator);
  }
  return accelerators;
}

/** Enabled, checked, title and accelerator state for every reader command's menu item. */
export function readerCommandStates(
  input: ReaderCommandStateInput,
  tools: readonly VerifiedMarkupTool[] = VERIFIED_MARKUP_TOOLS,
  pageRotation: boolean = PAGE_ROTATION_VERIFIED,
): ReaderCommandState[] {
  const accelerators = input.keybinds ? commandAccelerators(input.keybinds) : null;
  return readerCommands(tools, pageRotation).map((command) => ({
    id: command.id,
    ...command.state(input),
    ...(accelerators ? { accelerator: accelerators.get(command.id) ?? null } : {}),
  }));
}

/**
 * The native submenus (and inline sections) whose items come from the presets
 * and verified-tools lists, and the Rotate items behind the gate.
 */
export function readerMenuSubmenus(
  tools: readonly VerifiedMarkupTool[] = VERIFIED_MARKUP_TOOLS,
  pageRotation: boolean = PAGE_ROTATION_VERIFIED,
): ReaderMenuSubmenu[] {
  return [
    {
      id: APPEARANCE_SUBMENU,
      items: APPEARANCE_PRESETS.map(({ id, label }) => ({
        id: `${APPEARANCE_SUBMENU}.${id}`,
        text: label,
      })),
    },
    {
      id: ANNOTATE_SUBMENU,
      items: tools.map(({ id, label }) => ({ id: `${ANNOTATE_SUBMENU}.${id}`, text: label })),
    },
    {
      id: ROTATE_SECTION,
      items: pageRotation ? ROTATE_ITEMS.map(({ id, text }) => ({ id, text })) : [],
    },
  ];
}
