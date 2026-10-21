// The TypeScript → Rust path for native menu item state. Reader state lives in
// the WebView, so the WebView tells the native menu which items are enabled,
// checked or retitled (`set_menu_item_states`) and which items fill the
// submenus built from TypeScript lists (`set_menu_submenu_items`).
//
// Extending: add an optional field to NativeMenuItemState and to Rust's
// `MenuItemState` (src-tauri/src/menu.rs); unchanged fields are never resent.

import {
  type ReaderCommandContext,
  type ReaderCommandStateInput,
  type ReaderMenuSubmenu,
  readerCommandStates,
  readerMenuSubmenus,
  runReaderCommand,
} from './reader-commands';

export interface NativeMenuItemState {
  readonly id: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  readonly text?: string;
}

export type InvokeMenuCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface NativeMenuSync {
  /** Applies item states, sending only those that changed since the last sync. */
  setItemStates(states: readonly NativeMenuItemState[]): Promise<void>;
  /** Replaces each submenu's items (check items), then their states sync as usual. */
  setSubmenuItems(submenus: readonly ReaderMenuSubmenu[]): Promise<void>;
  /**
   * Records a click on a native item: check items flip their own mark, so the
   * item's state is resent on the next sync.
   */
  itemActivated(id: string): void;
}

const sameState = (left: NativeMenuItemState | undefined, right: NativeMenuItemState) =>
  left !== undefined &&
  left.enabled === right.enabled &&
  left.checked === right.checked &&
  left.text === right.text;

export function createNativeMenuSync(
  invoke: InvokeMenuCommand,
  {
    onError = (error: unknown) => console.error('Native menu sync failed:', error),
  }: { onError?: (error: unknown) => void } = {},
): NativeMenuSync {
  const applied = new Map<string, NativeMenuItemState>();
  return {
    async setItemStates(states) {
      const changed = states.filter((state) => !sameState(applied.get(state.id), state));
      if (changed.length === 0) return;
      for (const state of changed) applied.set(state.id, state);
      try {
        await invoke('set_menu_item_states', { items: changed });
      } catch (error) {
        for (const state of changed) applied.delete(state.id);
        onError(error);
      }
    },
    itemActivated(id) {
      applied.delete(id);
    },
    async setSubmenuItems(submenus) {
      for (const submenu of submenus) {
        for (const item of submenu.items) applied.delete(item.id);
        try {
          await invoke('set_menu_submenu_items', {
            submenuId: submenu.id,
            items: submenu.items,
          });
        } catch (error) {
          onError(error);
        }
      }
    },
  };
}

export interface ReaderMenuOptions {
  readonly nativeMenu: NativeMenuSync;
  /** The reader state the View, Go and Tools items reflect. */
  readonly stateInput: () => ReaderCommandStateInput;
  /** The input adapters commands go through; null before the chrome is mounted. */
  readonly context: () => ReaderCommandContext | null;
}

export interface ReaderMenu {
  /** Fills the listed submenus and applies the initial state. */
  install(): Promise<void>;
  /** Reflects the current reader state; call whenever it may have changed. */
  sync(): Promise<void>;
  /** Runs a View, Go or Tools item clicked in the native menu. */
  run(id: string): Promise<boolean>;
}

/** The native View, Go and Tools menus over the reader command table. */
export function createReaderMenu({
  nativeMenu,
  stateInput,
  context,
}: ReaderMenuOptions): ReaderMenu {
  const sync = () => nativeMenu.setItemStates(readerCommandStates(stateInput()));
  return {
    async install() {
      await nativeMenu.setSubmenuItems(readerMenuSubmenus());
      await sync();
    },
    sync,
    async run(id) {
      const commandContext = context();
      if (!commandContext) return false;
      nativeMenu.itemActivated(id);
      try {
        return await runReaderCommand(id, commandContext);
      } finally {
        await sync();
      }
    },
  };
}
