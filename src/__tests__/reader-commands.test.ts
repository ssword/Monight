import { describe, expect, it, vi } from 'vitest';
import {
  type ChromePreferences,
  type ChromePreferencesAuthority,
  DEFAULT_CHROME_PREFERENCES,
} from '../app/chrome-preferences';
import type { ActiveMarkupState } from '../app/document-workspace';
import {
  type ReaderCommandContext,
  type ReaderCommandStateInput,
  readerCommandStates,
  runReaderCommand,
} from '../app/reader-commands';
import type { ReaderAction } from '../reader/reader-actions';
import { defaultSettings } from '../scripts/settings';

function fakeContext(overrides: Partial<ReaderCommandContext> = {}) {
  const dispatched: ReaderAction[] = [];
  const calls: string[] = [];
  let preferences: ChromePreferences = { ...DEFAULT_CHROME_PREFERENCES };
  let markup: ActiveMarkupState | null = { activeToolId: null, readOnlyReason: null };
  const preferenceAuthority: ChromePreferencesAuthority = {
    snapshot: () => ({ ...preferences }),
    update: (changes) => {
      preferences = { ...preferences, ...changes };
    },
    observe: () => () => undefined,
    flush: async () => undefined,
  };
  const context: ReaderCommandContext = {
    dispatchReaderAction: async (action) => {
      dispatched.push(action);
    },
    preferences: preferenceAuthority,
    sidebar: { choose: (choice) => calls.push(`sidebar:${choice}`) },
    markupToolbar: {
      toggle: () => calls.push('markup-toolbar'),
      chooseTool: (toolId) => calls.push(`markup-toolbar:${toolId}`),
    },
    highlightButton: { activate: (toolId) => calls.push(`highlight-button:${toolId}`) },
    appearance: { choose: (preset) => calls.push(`appearance:${preset}`) },
    setActiveTool: (toolId) => {
      calls.push(`tool:${toolId}`);
      if (markup) markup = { ...markup, activeToolId: toolId };
    },
    toggleSlideshow: async () => {
      calls.push('slideshow');
    },
    toggleFullScreen: async () => {
      calls.push('full-screen');
    },
    requestPage: async () => 12,
    selectedPages: () => [],
    currentPage: () => 3,
    toggleTabBar: () => {
      calls.push('tab-bar');
    },
    editTextField: () => false,
    selectedAnnotation: () => null,
    ...overrides,
  };
  return {
    context,
    dispatched,
    calls,
    preferences: () => preferences,
    setMarkup: (next: ActiveMarkupState | null) => {
      markup = next;
    },
  };
}

describe('Reader Commands', () => {
  it.each([
    ['view.zoom.in', { type: 'zoomIn' }],
    ['view.zoom.out', { type: 'zoomOut' }],
    ['view.zoom.actual-size', { type: 'setZoomIntent', zoomIntent: { kind: 'manual', scale: 1 } }],
    ['view.zoom.fit', { type: 'setZoomIntent', zoomIntent: { kind: 'fit-page' } }],
    ['view.zoom.width', { type: 'setZoomIntent', zoomIntent: { kind: 'fit-width' } }],
    ['view.mode.continuous', { type: 'setViewMode', viewMode: 'continuous' }],
    ['view.mode.single', { type: 'setViewMode', viewMode: 'single' }],
    ['view.mode.spread', { type: 'setViewMode', viewMode: 'spread' }],
    ['go.previous-page', { type: 'goToPreviousPage' }],
    ['go.next-page', { type: 'goToNextPage' }],
    ['go.back', { type: 'goBack' }],
    ['go.forward', { type: 'goForward' }],
    ['edit.undo', { type: 'undoEdit' }],
    ['edit.redo', { type: 'redoEdit' }],
  ])('%s dispatches its typed Reader Action', async (id, action) => {
    const { context, dispatched } = fakeContext();
    expect(await runReaderCommand(id, context)).toBe(true);
    expect(dispatched).toEqual([action]);
  });

  it('Go to Page… asks for a page and jumps there, recorded in Navigation History', async () => {
    const { context, dispatched } = fakeContext();
    await runReaderCommand('go.page', context);
    expect(dispatched).toEqual([{ type: 'goToPage', page: 12, recordHistory: true }]);
  });

  it('Undo and Redo in a focused text field undo its typing instead of a Document edit', async () => {
    const edited: string[] = [];
    const { context, dispatched } = fakeContext({
      editTextField: (kind) => {
        edited.push(kind);
        return true;
      },
    });
    await runReaderCommand('edit.undo', context);
    await runReaderCommand('edit.redo', context);
    expect(edited).toEqual(['undo', 'redo']);
    expect(dispatched).toEqual([]);
  });

  it('Edit ▸ Delete deletes the selected Annotation from the Document it was selected in', async () => {
    const { context, dispatched } = fakeContext({
      selectedAnnotation: () => ({
        filePath: '/docs/report.pdf',
        id: 'mark-1',
        kind: 'highlight',
        contents: '',
        color: null,
        anchor: null,
      }),
    });
    expect(await runReaderCommand('edit.delete', context)).toBe(true);
    expect(dispatched).toEqual([
      {
        type: 'editAnnotation',
        filePath: '/docs/report.pdf',
        annotationId: 'mark-1',
        edit: { type: 'delete' },
      },
    ]);

    const nothingSelected = fakeContext();
    await runReaderCommand('edit.delete', nothingSelected.context);
    expect(nothingSelected.dispatched).toEqual([]);
  });

  it('Go to Page… does nothing when the request is cancelled', async () => {
    const { context, dispatched } = fakeContext({ requestPage: async () => null });
    await runReaderCommand('go.page', context);
    expect(dispatched).toEqual([]);
  });

  it.each([
    ['view.sidebar.hidden', 'sidebar:hidden'],
    ['view.sidebar.thumbnails', 'sidebar:thumbnails'],
    ['view.sidebar.tableOfContents', 'sidebar:tableOfContents'],
    ['view.sidebar.annotations', 'sidebar:annotations'],
    ['view.markup-toolbar', 'markup-toolbar'],
    ['view.slideshow', 'slideshow'],
    ['view.full-screen', 'full-screen'],
    ['view.appearance.sepia', 'appearance:sepia'],
    ['view.appearance.custom', 'appearance:custom'],
  ])('%s goes through the toolbar control it mirrors', async (id, call) => {
    const { context, calls, dispatched } = fakeContext();
    await runReaderCommand(id, context);
    expect(calls).toEqual([call]);
    expect(dispatched).toEqual([]);
  });

  it('Show Tab Bar toggles the tab bar for this app run, not as a chrome preference', async () => {
    const { context, calls, preferences } = fakeContext();
    await runReaderCommand('view.tab-bar', context);
    expect(calls).toEqual(['tab-bar']);
    expect(preferences()).toEqual(DEFAULT_CHROME_PREFERENCES);
  });

  it('Tools ▸ Annotate goes through the control that offers each verified tool', async () => {
    const { context, calls } = fakeContext();
    await runReaderCommand('tools.annotate.textComment', context);
    await runReaderCommand('tools.annotate.highlight', context);
    await runReaderCommand('tools.text-selection', context);
    expect(calls).toEqual([
      'markup-toolbar:textComment',
      'highlight-button:highlight',
      'tool:null',
    ]);
  });

  it('refuses unknown and unverified commands', async () => {
    const { context, calls, dispatched } = fakeContext();
    expect(await runReaderCommand('tools.annotate.ink', context)).toBe(false);
    expect(await runReaderCommand('view.appearance.neon', context)).toBe(false);
    expect(await runReaderCommand('view.nope', context)).toBe(false);
    expect([...calls, ...dispatched]).toEqual([]);
  });
});

const input = (overrides: Partial<ReaderCommandStateInput> = {}): ReaderCommandStateInput => ({
  documentCount: 1,
  activeDocument: {
    viewMode: 'continuous',
    filterSettings: {
      brightness: 0,
      grayscale: 0,
      invert: 25,
      sepia: 100,
      hue: 0,
      extraBrightness: -30,
    },
    currentPage: 3,
    pageCount: 10,
  },
  preferences: { ...DEFAULT_CHROME_PREFERENCES, sidebarVisible: true, sidebarMode: 'annotations' },
  markup: { activeToolId: 'textComment', readOnlyReason: null },
  fullScreen: false,
  canGoBack: false,
  canGoForward: false,
  tabBarKeptShown: false,
  textFieldFocused: false,
  annotationSelected: false,
  ...overrides,
});

const stateOf = (states: ReturnType<typeof readerCommandStates>, id: string) =>
  states.find((state) => state.id === id);

const checkedIds = (states: ReturnType<typeof readerCommandStates>) =>
  states.filter((state) => state.checked).map((state) => state.id);

describe('native menu state', () => {
  it('checks the sidebar mode, view mode, preset and active tool', () => {
    expect(checkedIds(readerCommandStates(input()))).toEqual([
      'view.sidebar.annotations',
      'view.mode.continuous',
      'view.appearance.sepia',
      'tools.annotate.textComment',
    ]);
  });

  it('checks Hide Sidebar and Text Selection when nothing is shown or chosen', () => {
    const states = readerCommandStates(
      input({
        preferences: { ...DEFAULT_CHROME_PREFERENCES, sidebarVisible: false },
        markup: { activeToolId: null, readOnlyReason: null },
      }),
    );
    expect(checkedIds(states)).toEqual([
      'view.sidebar.hidden',
      'view.mode.continuous',
      'view.appearance.sepia',
      'tools.text-selection',
    ]);
  });

  it('checks Custom when the filter matches no preset', () => {
    const states = readerCommandStates(
      input({
        activeDocument: {
          ...(input().activeDocument as NonNullable<ReaderCommandStateInput['activeDocument']>),
          filterSettings: {
            brightness: 1,
            grayscale: 2,
            invert: 3,
            sepia: 4,
            hue: 5,
            extraBrightness: 6,
          },
        },
      }),
    );
    expect(stateOf(states, 'view.appearance.custom')?.checked).toBe(true);
  });

  it('disables Document commands while no Document is open', () => {
    const states = readerCommandStates(
      input({ documentCount: 0, activeDocument: null, markup: null }),
    );
    const enabled = states.filter((state) => state.enabled).map((state) => state.id);
    expect(enabled).toEqual(['view.full-screen']);
    expect(checkedIds(states)).toEqual([]);
  });

  it('disables markup tools on a protected Document but keeps reading commands', () => {
    const states = readerCommandStates(
      input({ markup: { activeToolId: null, readOnlyReason: 'read-only' } }),
    );
    expect(stateOf(states, 'tools.annotate.highlight')?.enabled).toBe(false);
    expect(stateOf(states, 'tools.annotate.textComment')?.enabled).toBe(false);
    expect(stateOf(states, 'tools.text-selection')?.enabled).toBe(true);
    expect(stateOf(states, 'view.zoom.in')?.enabled).toBe(true);
    expect(stateOf(states, 'view.markup-toolbar')?.enabled).toBe(true);
  });

  it('enables Undo and Redo when the Document has an edit to undo or redo, or a text field is focused', () => {
    const none = readerCommandStates(input());
    expect(stateOf(none, 'edit.undo')?.enabled).toBe(false);
    expect(stateOf(none, 'edit.redo')?.enabled).toBe(false);

    const undoable = readerCommandStates(
      input({
        markup: { activeToolId: null, readOnlyReason: null, canUndo: true, canRedo: false },
      }),
    );
    expect(stateOf(undoable, 'edit.undo')?.enabled).toBe(true);
    expect(stateOf(undoable, 'edit.redo')?.enabled).toBe(false);

    const typing = readerCommandStates(input({ activeDocument: null, textFieldFocused: true }));
    expect(stateOf(typing, 'edit.undo')?.enabled).toBe(true);
    expect(stateOf(typing, 'edit.redo')?.enabled).toBe(true);
  });

  it('enables Delete only while an Annotation of an editable Document is selected and no text field is focused', () => {
    expect(stateOf(readerCommandStates(input()), 'edit.delete')?.enabled).toBe(false);
    expect(
      stateOf(readerCommandStates(input({ annotationSelected: true })), 'edit.delete')?.enabled,
    ).toBe(true);
    expect(
      stateOf(
        readerCommandStates(input({ annotationSelected: true, textFieldFocused: true })),
        'edit.delete',
      )?.enabled,
    ).toBe(false);
    expect(
      stateOf(
        readerCommandStates(
          input({
            annotationSelected: true,
            markup: { activeToolId: null, readOnlyReason: 'read-only' },
          }),
        ),
        'edit.delete',
      )?.enabled,
    ).toBe(false);
  });

  it('disables page steps at the first and last page', () => {
    const first = readerCommandStates(
      input({
        activeDocument: {
          ...(input().activeDocument as NonNullable<ReaderCommandStateInput['activeDocument']>),
          currentPage: 1,
        },
      }),
    );
    expect(stateOf(first, 'go.previous-page')?.enabled).toBe(false);
    expect(stateOf(first, 'go.next-page')?.enabled).toBe(true);
    const last = readerCommandStates(
      input({
        activeDocument: {
          ...(input().activeDocument as NonNullable<ReaderCommandStateInput['activeDocument']>),
          currentPage: 10,
        },
      }),
    );
    expect(stateOf(last, 'go.previous-page')?.enabled).toBe(true);
    expect(stateOf(last, 'go.next-page')?.enabled).toBe(false);
  });

  it('enables Back and Forward only when Navigation History has somewhere to go', () => {
    const none = readerCommandStates(input());
    expect(stateOf(none, 'go.back')?.enabled).toBe(false);
    expect(stateOf(none, 'go.forward')?.enabled).toBe(false);

    const back = readerCommandStates(input({ canGoBack: true }));
    expect(stateOf(back, 'go.back')?.enabled).toBe(true);
    expect(stateOf(back, 'go.forward')?.enabled).toBe(false);

    const forward = readerCommandStates(input({ canGoForward: true }));
    expect(stateOf(forward, 'go.back')?.enabled).toBe(false);
    expect(stateOf(forward, 'go.forward')?.enabled).toBe(true);

    const closed = readerCommandStates(
      input({ activeDocument: null, documentCount: 0, canGoBack: true, canGoForward: true }),
    );
    expect(stateOf(closed, 'go.back')?.enabled).toBe(false);
    expect(stateOf(closed, 'go.forward')?.enabled).toBe(false);
  });

  it('names the tab bar, markup toolbar and full screen items by what they will do', () => {
    const shown = readerCommandStates(
      input({
        documentCount: 1,
        tabBarKeptShown: true,
        preferences: { ...DEFAULT_CHROME_PREFERENCES, markupToolbarVisible: true },
        fullScreen: true,
      }),
    );
    expect(stateOf(shown, 'view.tab-bar')).toMatchObject({ text: 'Hide Tab Bar', enabled: true });
    expect(stateOf(shown, 'view.markup-toolbar')?.text).toBe('Hide Markup Toolbar');
    expect(stateOf(shown, 'view.full-screen')?.text).toBe('Exit Full Screen');

    const hidden = readerCommandStates(input());
    expect(stateOf(hidden, 'view.tab-bar')?.text).toBe('Show Tab Bar');
    expect(stateOf(hidden, 'view.markup-toolbar')?.text).toBe('Show Markup Toolbar');
    expect(stateOf(hidden, 'view.full-screen')?.text).toBe('Enter Full Screen');
  });

  it('shows each command’s effective shortcut as its menu accelerator', () => {
    const keybinds = defaultSettings('mac').keybinds;
    keybinds.Fullscreen.binds = ['Ctrl+Alt+Enter'];
    keybinds.ViewSinglePage.binds = [];
    keybinds.SwitchToTab1.binds = ['Cmd+Alt+Shift+1'];
    const accelerators = Object.fromEntries(
      readerCommandStates(input({ keybinds }))
        .filter(({ accelerator }) => accelerator !== undefined)
        .map(({ id, accelerator }) => [id, accelerator]),
    );

    expect(accelerators).toMatchObject({
      'view.mode.continuous': 'CmdOrCtrl+1',
      'view.mode.single': null,
      'view.mode.spread': 'CmdOrCtrl+3',
      'view.sidebar.hidden': 'CmdOrCtrl+Alt+1',
      'view.sidebar.annotations': 'CmdOrCtrl+Alt+4',
      'view.zoom.actual-size': 'CmdOrCtrl+0',
      'view.zoom.fit': 'CmdOrCtrl+9',
      'view.zoom.width': 'CmdOrCtrl+Shift+W',
      'view.zoom.in': 'CmdOrCtrl+=',
      'view.zoom.out': 'CmdOrCtrl+-',
      'view.markup-toolbar': 'CmdOrCtrl+Shift+A',
      'view.slideshow': 'CmdOrCtrl+Shift+F',
      'view.full-screen': 'Ctrl+Alt+Enter',
      'go.page': 'CmdOrCtrl+Alt+G',
      'go.back': 'CmdOrCtrl+[',
      'go.forward': 'CmdOrCtrl+]',
      // Unmodified keys stay with the page so the menu never takes them from text fields.
      'go.next-page': null,
      'go.previous-page': null,
      'view.tab-bar': null,
    });
  });

  it('shows a menu accelerator only for keys the native menu can show', () => {
    const keybinds = defaultSettings('other').keybinds;
    keybinds.ZoomIn.binds = ['CmdOrCtrl+Plus', 'Alt+='];
    keybinds.NextPage.binds = ['ArrowRight', 'Alt+ArrowDown'];
    keybinds.PresentationMode.binds = ['Shift+F5'];
    const states = readerCommandStates(input({ keybinds }));

    expect(stateOf(states, 'view.zoom.in')?.accelerator).toBe('Alt+=');
    expect(stateOf(states, 'go.next-page')?.accelerator).toBe('Alt+ArrowDown');
    expect(stateOf(states, 'view.slideshow')?.accelerator).toBe('Shift+F5');
    expect(stateOf(states, 'view.full-screen')?.accelerator).toBe('F11');
  });

  it('cannot hide the tab bar while several Documents are open', () => {
    const states = readerCommandStates(input({ documentCount: 2 }));
    expect(stateOf(states, 'view.tab-bar')).toMatchObject({
      text: 'Hide Tab Bar',
      enabled: false,
    });
  });
});

describe('native menu ids', () => {
  it('match the items built by src-tauri/src/menu.rs', async () => {
    const { readFileSync } = await import('node:fs');
    const { readerMenuSubmenus } = await import('../app/reader-commands');
    const menuSource = readFileSync('src-tauri/src/menu.rs', 'utf8');
    const definitions = menuSource.slice(0, menuSource.indexOf('#[cfg(test)]'));
    const rustIds = [...definitions.matchAll(/"((?:edit|view|go|tools)\.[A-Za-z.-]+)"/g)].map(
      ([, id]) => id,
    );

    const listed = readerMenuSubmenus();
    const listedItemIds = new Set(listed.flatMap(({ items }) => items.map(({ id }) => id)));
    const staticIds = readerCommandStates(input())
      .map(({ id }) => id)
      .filter((id) => !listedItemIds.has(id));

    expect(new Set(rustIds)).toEqual(new Set([...staticIds, ...listed.map(({ id }) => id)]));
  });
});

describe('native menu listing', () => {
  it('Annotate lists exactly the verified tools and View lists every preset', async () => {
    const { readerMenuSubmenus } = await import('../app/reader-commands');
    expect(readerMenuSubmenus(undefined, false)).toEqual([
      {
        id: 'view.appearance',
        items: [
          { id: 'view.appearance.default', text: 'Default' },
          { id: 'view.appearance.original', text: 'Original' },
          { id: 'view.appearance.redeye', text: 'Redeye' },
          { id: 'view.appearance.sepia', text: 'Sepia' },
          { id: 'view.appearance.custom', text: 'Custom' },
        ],
      },
      {
        id: 'tools.annotate',
        items: [
          { id: 'tools.annotate.highlight', text: 'Highlight' },
          { id: 'tools.annotate.underline', text: 'Underline' },
          { id: 'tools.annotate.strikeout', text: 'Strikethrough' },
          { id: 'tools.annotate.textComment', text: 'Text Note' },
        ],
      },
      // Rotate Left and Right stay unlisted until Page Rotation is verified.
      { id: 'tools.rotate', items: [] },
    ]);
  });

  it('a newly verified tool joins Annotate without other changes', async () => {
    const { readerMenuSubmenus } = await import('../app/reader-commands');
    const tools = [
      {
        id: 'underline',
        label: 'Underline',
        icon: 'underline',
        control: 'highlight-menu' as const,
        verification: ['docs/x.md'],
      },
    ];
    expect(readerMenuSubmenus(tools)[1]?.items).toEqual([
      { id: 'tools.annotate.underline', text: 'Underline' },
    ]);
    const { context, calls } = fakeContext();
    expect(await runReaderCommand('tools.annotate.underline', context, tools)).toBe(true);
    expect(calls).toEqual(['highlight-button:underline']);
    vi.restoreAllMocks();
  });
});

describe('Rotate commands behind the Page Rotation gate', () => {
  const verified = true;

  it('rotate the current page when no thumbnails are selected', async () => {
    const { context, dispatched } = fakeContext();
    expect(await runReaderCommand('tools.rotate.left', context, undefined, verified)).toBe(true);
    expect(await runReaderCommand('tools.rotate.right', context, undefined, verified)).toBe(true);
    expect(dispatched).toEqual([
      { type: 'rotatePages', pages: [3], direction: 'counterclockwise' },
      { type: 'rotatePages', pages: [3], direction: 'clockwise' },
    ]);
  });

  it('rotate the selected pages when thumbnails are selected', async () => {
    const { context, dispatched } = fakeContext({ selectedPages: () => [2, 5, 6] });
    await runReaderCommand('tools.rotate.right', context, undefined, verified);
    expect(dispatched).toEqual([{ type: 'rotatePages', pages: [2, 5, 6], direction: 'clockwise' }]);
  });

  it('do nothing without a page to rotate', async () => {
    const { context, dispatched } = fakeContext({ currentPage: () => null });
    await runReaderCommand('tools.rotate.left', context, undefined, verified);
    expect(dispatched).toEqual([]);
  });

  it('are absent while Page Rotation is unverified', async () => {
    const { context, dispatched } = fakeContext();
    expect(await runReaderCommand('tools.rotate.left', context, undefined, false)).toBe(false);
    expect(await runReaderCommand('tools.rotate.right', context, undefined, false)).toBe(false);
    expect(dispatched).toEqual([]);
    const ids = readerCommandStates(input(), undefined, false).map(({ id }) => id);
    expect(ids.filter((id) => id.includes('rotate'))).toEqual([]);
    const { readerMenuSubmenus } = await import('../app/reader-commands');
    expect(readerMenuSubmenus(undefined, false).find(({ id }) => id === 'tools.rotate')).toEqual({
      id: 'tools.rotate',
      items: [],
    });
  });

  it('list Rotate Left and Rotate Right in the Tools menu once verified', async () => {
    const { readerMenuSubmenus } = await import('../app/reader-commands');
    expect(readerMenuSubmenus(undefined, verified).find(({ id }) => id === 'tools.rotate')).toEqual(
      {
        id: 'tools.rotate',
        items: [
          { id: 'tools.rotate.left', text: 'Rotate Left' },
          { id: 'tools.rotate.right', text: 'Rotate Right' },
        ],
      },
    );
  });

  it('are unavailable on protected Documents and without a Document', () => {
    const editable = readerCommandStates(input(), undefined, verified);
    expect(stateOf(editable, 'tools.rotate.left')?.enabled).toBe(true);
    expect(stateOf(editable, 'tools.rotate.right')?.enabled).toBe(true);
    const protectedDocument = readerCommandStates(
      input({ markup: { activeToolId: null, readOnlyReason: 'Signed Document' } }),
      undefined,
      verified,
    );
    expect(stateOf(protectedDocument, 'tools.rotate.left')?.enabled).toBe(false);
    expect(stateOf(protectedDocument, 'tools.rotate.right')?.enabled).toBe(false);
    const none = readerCommandStates(
      input({ documentCount: 0, activeDocument: null, markup: null }),
      undefined,
      verified,
    );
    expect(stateOf(none, 'tools.rotate.left')?.enabled).toBe(false);
  });

  it('show ⌘L and ⌘R as their menu accelerators', async () => {
    const { defaultKeybinds } = await import('../scripts/keybind-defaults');
    const keybinds = defaultKeybinds('mac', { pageRotation: true });
    const states = readerCommandStates(input({ keybinds }), undefined, verified);
    expect(stateOf(states, 'tools.rotate.left')?.accelerator).toBe('CmdOrCtrl+L');
    expect(stateOf(states, 'tools.rotate.right')?.accelerator).toBe('CmdOrCtrl+R');
  });
});
