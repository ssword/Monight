import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHROME_PREFERENCES } from '../app/chrome-preferences';
import { createNativeMenuSync, createReaderMenu } from '../app/native-menu';
import type { ReaderCommandContext } from '../app/reader-commands';
import { type FilterSettings, PRESETS } from '../scripts/filters';

const recordInvoke = () => {
  const calls: Array<[string, unknown]> = [];
  const invoke = vi.fn(async (command: string, args: unknown) => {
    calls.push([command, args]);
  });
  return { invoke, calls };
};

describe('native menu state sync', () => {
  it('sends enabled, checked and title state to the native menu', async () => {
    const { invoke, calls } = recordInvoke();
    const menu = createNativeMenuSync(invoke);

    await menu.setItemStates([
      { id: 'view.zoom.in', enabled: true },
      { id: 'view.mode.single', enabled: true, checked: true },
      { id: 'view.full-screen', enabled: true, text: 'Enter Full Screen' },
    ]);

    expect(calls).toEqual([
      [
        'set_menu_item_states',
        {
          items: [
            { id: 'view.zoom.in', enabled: true },
            { id: 'view.mode.single', enabled: true, checked: true },
            { id: 'view.full-screen', enabled: true, text: 'Enter Full Screen' },
          ],
        },
      ],
    ]);
  });

  it('sends only the items whose state changed', async () => {
    const { invoke, calls } = recordInvoke();
    const menu = createNativeMenuSync(invoke);
    await menu.setItemStates([
      { id: 'view.mode.single', enabled: true, checked: true },
      { id: 'view.mode.spread', enabled: true, checked: false },
    ]);
    calls.length = 0;

    await menu.setItemStates([
      { id: 'view.mode.single', enabled: true, checked: true },
      { id: 'view.mode.spread', enabled: true, checked: false },
    ]);
    expect(calls).toEqual([]);

    await menu.setItemStates([
      { id: 'view.mode.single', enabled: true, checked: false },
      { id: 'view.mode.spread', enabled: true, checked: true },
    ]);
    expect(calls).toEqual([
      [
        'set_menu_item_states',
        {
          items: [
            { id: 'view.mode.single', enabled: true, checked: false },
            { id: 'view.mode.spread', enabled: true, checked: true },
          ],
        },
      ],
    ]);
  });

  it('sends a changed accelerator, including its removal', async () => {
    const { invoke, calls } = recordInvoke();
    const menu = createNativeMenuSync(invoke);
    await menu.setItemStates([
      { id: 'view.mode.single', enabled: true, accelerator: 'CmdOrCtrl+2' },
    ]);
    calls.length = 0;

    await menu.setItemStates([
      { id: 'view.mode.single', enabled: true, accelerator: 'CmdOrCtrl+2' },
    ]);
    await menu.setItemStates([{ id: 'view.mode.single', enabled: true, accelerator: null }]);

    expect(calls).toEqual([
      [
        'set_menu_item_states',
        { items: [{ id: 'view.mode.single', enabled: true, accelerator: null }] },
      ],
    ]);
  });

  it('resends state the native menu failed to apply', async () => {
    const invoke = vi
      .fn<(command: string, args: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error('menu unavailable'))
      .mockResolvedValue(undefined);
    const menu = createNativeMenuSync(invoke, { onError: () => undefined });
    const states = [{ id: 'print', enabled: true }];

    await menu.setItemStates(states);
    await menu.setItemStates(states);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('resends an item the native menu toggled on its own when clicked', async () => {
    const { invoke, calls } = recordInvoke();
    const menu = createNativeMenuSync(invoke);
    const states = [{ id: 'view.mode.single', enabled: true, checked: true }];
    await menu.setItemStates(states);
    calls.length = 0;

    // A native check item flips its own mark when clicked.
    menu.itemActivated('view.mode.single');
    await menu.setItemStates(states);

    expect(calls).toEqual([['set_menu_item_states', { items: states }]]);
  });

  it('runs a reader menu command and then reflects the new reader state', async () => {
    const { invoke, calls } = recordInvoke();
    let viewMode: 'single' | 'continuous' = 'single';
    const readerMenu = createReaderMenu({
      nativeMenu: createNativeMenuSync(invoke),
      stateInput: () => ({
        documentCount: 1,
        activeDocument: {
          viewMode,
          filterSettings: { ...PRESETS.default } as FilterSettings,
          currentPage: 1,
          pageCount: 2,
        },
        preferences: DEFAULT_CHROME_PREFERENCES,
        markup: { activeToolId: null, readOnlyReason: null },
        fullScreen: false,
        canGoBack: false,
        canGoForward: false,
        tabBarKeptShown: false,
        textFieldFocused: false,
      }),
      context: () =>
        ({
          dispatchReaderAction: async (action: { type: string; viewMode?: typeof viewMode }) => {
            if (action.type === 'setViewMode' && action.viewMode) viewMode = action.viewMode;
          },
        }) as unknown as ReaderCommandContext,
    });

    await readerMenu.install();
    const installed = calls.map(([command]) => command);
    expect(installed).toEqual([
      // Appearance, Annotate, and the Rotate section (empty until verified).
      'set_menu_submenu_items',
      'set_menu_submenu_items',
      'set_menu_submenu_items',
      'set_menu_item_states',
    ]);
    calls.length = 0;

    expect(await readerMenu.run('view.mode.continuous')).toBe(true);

    expect(calls).toEqual([
      [
        'set_menu_item_states',
        {
          items: [
            { id: 'view.mode.continuous', enabled: true, checked: true },
            { id: 'view.mode.single', enabled: true, checked: false },
          ],
        },
      ],
    ]);
  });

  it('fills submenus built from TypeScript lists, after which their states sync', async () => {
    const { invoke, calls } = recordInvoke();
    const menu = createNativeMenuSync(invoke);

    await menu.setSubmenuItems([
      { id: 'tools.annotate', items: [{ id: 'tools.annotate.highlight', text: 'Highlight' }] },
    ]);

    expect(calls).toEqual([
      [
        'set_menu_submenu_items',
        {
          submenuId: 'tools.annotate',
          items: [{ id: 'tools.annotate.highlight', text: 'Highlight' }],
        },
      ],
    ]);
  });
});
