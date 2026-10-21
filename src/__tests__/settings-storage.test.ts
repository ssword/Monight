import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const writes: string[] = [];

  return {
    values,
    writes,
    reset(initial: Record<string, unknown> = {}) {
      values.clear();
      writes.length = 0;
      for (const [key, value] of Object.entries(initial)) values.set(key, structuredClone(value));
    },
    load: vi.fn(async () => ({
      get: vi.fn(async (key: string) => structuredClone(values.get(key))),
      set: vi.fn(async (key: string, value: unknown) => {
        writes.push(key);
        values.set(key, structuredClone(value));
      }),
      delete: vi.fn(async (key: string) => {
        writes.push(`delete:${key}`);
        values.delete(key);
      }),
      save: vi.fn(async () => undefined),
    })),
  };
});

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: store.load } }));

import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, SettingsManager } from '../scripts/settings';

const legacyAnnotation = {
  id: 'note-1',
  kind: 'note',
  pageNumber: 4,
  rects: [{ x1: 10, y1: 20, x2: 30, y2: 40 }],
  text: '',
  note: 'Remember this',
  color: 'yellow',
  createdAt: 10,
  updatedAt: 10,
};

const legacySession = {
  version: 1,
  activeFilePath: '/books/one.pdf',
  tabs: [
    {
      filePath: '/books/one.pdf',
      title: 'one.pdf',
      currentPage: 4,
      scrollPosition: 842,
      filterSettings: {
        brightness: 90,
        grayscale: 0,
        invert: 80,
        sepia: 10,
        hue: 15,
        extraBrightness: 100,
      },
      zoom: 1.25,
      rotation: 90,
      viewMode: 'continuous',
    },
  ],
};

describe('settings storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.reset();
  });

  it('defaults annotation attribution to Guest and restores an explicit display name', async () => {
    const defaults = await new SettingsManager('main').load();

    expect(defaults.general.annotationDisplayName).toBe('Guest');

    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      general: { ...DEFAULT_SETTINGS.general, annotationDisplayName: 'Ada Lovelace' },
    });

    const persisted = await new SettingsManager('main').load();

    expect(persisted.general.annotationDisplayName).toBe('Ada Lovelace');
  });

  it('normalizes an empty annotation display name to Guest', async () => {
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      general: { ...DEFAULT_SETTINGS.general, annotationDisplayName: '   ' },
    });

    const settings = await new SettingsManager('main').load();

    expect(settings.general.annotationDisplayName).toBe('Guest');
  });

  it('migrates supported concerns without moving or deleting legacy annotations', async () => {
    const legacy = {
      version: '1.0.6',
      general: { ...DEFAULT_SETTINGS.general, maximizeOnOpen: false },
      keybinds: {
        ...DEFAULT_SETTINGS.keybinds,
        OpenFile: { ...DEFAULT_SETTINGS.keybinds.OpenFile, binds: ['Ctrl+Shift+O'] },
      },
      lastSession: legacySession,
      recentFiles: [{ filePath: '/books/one.pdf', title: 'one.pdf', openedAt: 42 }],
      annotations: { '/books/one.pdf': [legacyAnnotation] },
      lastFilter: {
        brightness: 80,
        grayscale: 0,
        invert: 100,
        sepia: 0,
        hue: 0,
        extraBrightness: 100,
      },
    };
    store.reset({ settings: legacy });

    const settings = await new SettingsManager('main').load();

    expect(settings.general.maximizeOnOpen).toBe(false);
    expect(settings.keybinds.OpenFile.binds).toEqual(['Ctrl+Shift+O']);
    expect(settings).not.toHaveProperty('recentFiles');
    expect(store.values.get('recentFiles')).toEqual(legacy.recentFiles);
    expect(settings).not.toHaveProperty('annotations');
    expect(store.values.has('annotations')).toBe(false);
    expect(settings.lastFilter).toEqual(legacy.lastFilter);
    expect(store.values.get('readingSession')).toEqual({
      schemaVersion: 3,
      activeDocumentPath: '/books/one.pdf',
      documents: [
        {
          filePath: '/books/one.pdf',
          title: 'one.pdf',
          readingPosition: { page: 4, legacyOffset: 842 },
          visualState: {
            filterSettings: legacySession.tabs[0].filterSettings,
            zoomIntent: { kind: 'manual', scale: 1.25 },
            viewMode: 'continuous',
          },
        },
      ],
    });
    expect(store.values.get('storageSchemaVersion')).toBe(SETTINGS_SCHEMA_VERSION);
    expect(store.values.get('settings')).toEqual(legacy);

    store.writes.length = 0;
    await new SettingsManager('settings').load();
    expect(store.writes).toEqual([]);
  });

  it('offers no view-rotation shortcut and ignores stored view-rotation bindings', async () => {
    expect(Object.values(DEFAULT_SETTINGS.keybinds).map(({ action }) => action)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^rotate/)]),
    );
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybinds: {
        ...DEFAULT_SETTINGS.keybinds,
        RotateClockwise: {
          displayName: 'Rotate Right',
          binds: ['CmdOrCtrl+R'],
          action: 'rotateRight',
        },
        RotateCounterClockwise: {
          displayName: 'Rotate Left',
          binds: ['CmdOrCtrl+Shift+R'],
          action: 'rotateLeft',
        },
      },
    });

    const settings = await new SettingsManager('settings').load();

    expect(settings.keybinds).not.toHaveProperty('RotateClockwise');
    expect(settings.keybinds).not.toHaveProperty('RotateCounterClockwise');
  });

  it('names Presentation Mode Slideshow while keeping a stored binding', async () => {
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybinds: {
        ...DEFAULT_SETTINGS.keybinds,
        PresentationMode: {
          displayName: 'Presentation Mode',
          binds: ['Ctrl+Alt+P'],
          action: 'presentationMode',
        },
      },
    });

    const settings = await new SettingsManager('settings').load();

    expect(settings.keybinds.PresentationMode).toEqual({
      displayName: 'Slideshow',
      binds: ['Ctrl+Alt+P'],
      action: 'presentationMode',
    });
  });

  it('writes only the requested concern and rejects keys not owned by the window', async () => {
    const settingsWindow = new SettingsManager('settings');
    await settingsWindow.load();
    store.writes.length = 0;

    await settingsWindow.set('general', {
      ...DEFAULT_SETTINGS.general,
      maximizeOnOpen: false,
    });

    expect(store.writes).toEqual(['general']);
    await expect(
      // @ts-expect-error verifies runtime discipline for untyped callers too
      settingsWindow.set('annotations', {}),
    ).rejects.toThrow('Settings window cannot write annotations');

    const mainWindow = new SettingsManager('main');
    await mainWindow.load();
    await expect(
      // @ts-expect-error Recent Documents belong to their dedicated authority
      mainWindow.set('recentFiles', []),
    ).rejects.toThrow('Main window cannot write recentFiles');
    await expect(
      // @ts-expect-error Annotations belong to their dedicated authority
      mainWindow.set('annotations', {}),
    ).rejects.toThrow('Main window cannot write annotations');
    await expect(
      // @ts-expect-error verifies runtime discipline for untyped callers too
      mainWindow.set('keybinds', DEFAULT_SETTINGS.keybinds),
    ).rejects.toThrow('Main window cannot write keybinds');
  });

  it('preserves a keybind change across an interleaved Reading Session save', async () => {
    const settingsWindow = new SettingsManager('settings');
    const mainWindow = new SettingsManager('main');
    await Promise.all([settingsWindow.load(), mainWindow.load()]);

    const keybinds = structuredClone(DEFAULT_SETTINGS.keybinds);
    keybinds.OpenFile.binds = ['Ctrl+Alt+O'];
    await settingsWindow.set('keybinds', keybinds);
    await mainWindow.writePersistedReadingSession({
      schemaVersion: 3,
      activeDocumentPath: '/books/two.pdf',
      documents: [
        {
          filePath: '/books/two.pdf',
          title: 'two.pdf',
          readingPosition: { page: 7, location: 0.5 },
        },
      ],
    });

    expect(store.values.get('keybinds')).toEqual(keybinds);
    expect(store.values.get('readingSession')).toEqual(
      expect.objectContaining({ activeDocumentPath: '/books/two.pdf' }),
    );
  });

  it('clears only the Reading Session concern from the settings store', async () => {
    const mainWindow = new SettingsManager('main');
    await mainWindow.load();
    store.values.set('recentFiles', [
      { filePath: '/books/one.pdf', title: 'one.pdf', openedAt: 42 },
    ]);
    await mainWindow.writePersistedReadingSession({
      schemaVersion: 3,
      activeDocumentPath: '/books/one.pdf',
      documents: [
        {
          filePath: '/books/one.pdf',
          title: 'one.pdf',
          readingPosition: { page: 1, location: 0 },
        },
      ],
    });
    const keybinds = structuredClone(store.values.get('keybinds'));
    const general = structuredClone(store.values.get('general'));

    store.writes.length = 0;
    await mainWindow.clearPersistedReadingSession();

    expect(store.values.get('recentFiles')).toEqual([
      { filePath: '/books/one.pdf', title: 'one.pdf', openedAt: 42 },
    ]);
    expect(store.values.has('annotations')).toBe(false);
    expect(store.values.get('readingSession')).toEqual({
      schemaVersion: 3,
      activeDocumentPath: null,
      documents: [],
    });
    expect(store.values.get('keybinds')).toEqual(keybinds);
    expect(store.values.get('general')).toEqual(general);
    expect(store.writes).toEqual(['readingSession']);
  });

  it('exposes legacy Recent Documents only for verified dedicated-store migration', async () => {
    const legacy = [{ filePath: '/books/one.pdf', title: 'one.pdf', openedAt: 42 }];
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      recentFiles: legacy,
    });
    const mainWindow = new SettingsManager('main');

    await expect(mainWindow.readLegacyRecentDocuments()).resolves.toEqual(legacy);
    expect(store.values.get('recentFiles')).toEqual(legacy);

    await mainWindow.removeLegacyRecentDocuments();

    expect(store.values.has('recentFiles')).toBe(false);
    expect(store.writes).toContain('delete:recentFiles');
  });
});

const bindsOf = (keybinds: Record<string, { binds: string[] }>) =>
  Object.fromEntries(Object.entries(keybinds).map(([id, { binds }]) => [id, binds]));

describe('Preview shortcut defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.reset();
  });

  it('gives a fresh macOS install the Preview shortcuts', async () => {
    const settings = await new SettingsManager('main', { platform: 'mac' }).load();

    expect(bindsOf(settings.keybinds)).toMatchObject({
      ViewContinuous: ['CmdOrCtrl+1'],
      ViewSinglePage: ['CmdOrCtrl+2'],
      ViewTwoPages: ['CmdOrCtrl+3'],
      ResetZoom: ['CmdOrCtrl+0'],
      FitToPage: ['CmdOrCtrl+9'],
      FitToWidth: ['CmdOrCtrl+Shift+W'],
      SidebarHidden: ['CmdOrCtrl+Alt+1'],
      SidebarThumbnails: ['CmdOrCtrl+Alt+2'],
      SidebarTableOfContents: ['CmdOrCtrl+Alt+3'],
      SidebarAnnotations: ['CmdOrCtrl+Alt+4'],
      MarkupToolbar: ['CmdOrCtrl+Shift+A'],
      GoToPage: ['CmdOrCtrl+Alt+G'],
      PresentationMode: ['CmdOrCtrl+Shift+F'],
      Fullscreen: ['Ctrl+Cmd+F'],
      NextTab: ['Ctrl+Tab', 'Cmd+Shift+]'],
      PreviousTab: ['Ctrl+Shift+Tab', 'Cmd+Shift+['],
    });
    for (let position = 1; position <= 9; position += 1) {
      expect(settings.keybinds[`SwitchToTab${position}`]).toMatchObject({
        action: 'switchToTab',
        data: String(position),
        binds: [],
      });
    }
  });

  it('gives a fresh Windows or Linux install F11 Full Screen and Ctrl+Tab tab switching', async () => {
    const settings = await new SettingsManager('main', { platform: 'other' }).load();

    expect(bindsOf(settings.keybinds)).toMatchObject({
      ViewSinglePage: ['CmdOrCtrl+2'],
      SidebarThumbnails: ['CmdOrCtrl+Alt+2'],
      Fullscreen: ['F11'],
      NextTab: ['Ctrl+Tab', 'Ctrl+PageDown'],
      PreviousTab: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
      SwitchToTab1: [],
    });
  });

  // The keybind map an install stored before Preview's shortcuts.
  const storedBeforePreview = (changes: Record<string, string[]> = {}) => {
    const v1: Record<string, [string[], string, string?]> = {
      OpenFile: [['CmdOrCtrl+O'], 'openFile'],
      CloseTab: [['CmdOrCtrl+W'], 'closeTab'],
      ReopenTab: [['CmdOrCtrl+Shift+T'], 'reopenTab'],
      NextTab: [['CmdOrCtrl+Tab', 'CmdOrCtrl+PageDown'], 'nextTab'],
      PreviousTab: [['CmdOrCtrl+Shift+Tab', 'CmdOrCtrl+PageUp'], 'previousTab'],
      Print: [['CmdOrCtrl+P'], 'print'],
      Find: [['CmdOrCtrl+F'], 'find'],
      ZoomIn: [['CmdOrCtrl+=', 'CmdOrCtrl+Plus'], 'zoomIn'],
      ZoomOut: [['CmdOrCtrl+-'], 'zoomOut'],
      ResetZoom: [['CmdOrCtrl+0'], 'resetZoom'],
      Settings: [['Alt+S'], 'openSettings'],
      NextPage: [['ArrowRight', 'ArrowDown'], 'nextPage'],
      PreviousPage: [['ArrowLeft', 'ArrowUp'], 'previousPage'],
      FirstPage: [['Home'], 'firstPage'],
      LastPage: [['End'], 'lastPage'],
      FitToWidth: [['CmdOrCtrl+Shift+W'], 'fitToWidth'],
      FitToPage: [['CmdOrCtrl+Shift+P'], 'fitToPage'],
      ...Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [
          `SwitchToTab${n}`,
          [[`CmdOrCtrl+${n}`], 'switchToTab', String(n)],
        ]),
      ),
      Fullscreen: [['F11'], 'toggleFullscreen'],
      PresentationMode: [['Shift+F11'], 'presentationMode'],
    };
    return Object.fromEntries(
      Object.entries(v1).map(([id, [binds, action, data]]) => [
        id,
        { displayName: id, binds: changes[id] ?? binds, action, ...(data ? { data } : {}) },
      ]),
    );
  };

  it('upgrades the shortcuts a reader never rebound to Preview defaults', async () => {
    store.reset({ storageSchemaVersion: SETTINGS_SCHEMA_VERSION, keybinds: storedBeforePreview() });

    const settings = await new SettingsManager('main', { platform: 'mac' }).load();

    expect(bindsOf(settings.keybinds)).toMatchObject({
      OpenFile: ['CmdOrCtrl+O'],
      FitToPage: ['CmdOrCtrl+9'],
      ViewContinuous: ['CmdOrCtrl+1'],
      SidebarThumbnails: ['CmdOrCtrl+Alt+2'],
      Fullscreen: ['Ctrl+Cmd+F'],
      PresentationMode: ['CmdOrCtrl+Shift+F'],
      NextTab: ['Ctrl+Tab', 'Cmd+Shift+]'],
      SwitchToTab1: [],
      SwitchToTab9: [],
    });
    expect(settings.keybinds.FitToPage.displayName).toBe('Zoom to Fit');
  });

  it('keeps every shortcut the reader rebound across the upgrade', async () => {
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybinds: storedBeforePreview({
        Fullscreen: ['Ctrl+Alt+Enter'],
        FitToPage: [],
        SwitchToTab2: ['Alt+2'],
      }),
    });

    const settings = await new SettingsManager('main', { platform: 'mac' }).load();

    expect(bindsOf(settings.keybinds)).toMatchObject({
      Fullscreen: ['Ctrl+Alt+Enter'],
      FitToPage: [],
      SwitchToTab2: ['Alt+2'],
      SwitchToTab3: [],
      ViewSinglePage: ['CmdOrCtrl+2'],
    });
  });

  it('drops a new default that collides with a binding the reader chose', async () => {
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybinds: storedBeforePreview({
        // Kept on purpose alongside another binding: the reader chose ⌘1 for tab 1.
        SwitchToTab1: ['CmdOrCtrl+1', 'Alt+1'],
        // The same chord written differently is still the reader's.
        Find: ['CmdOrCtrl+F', 'Cmd+Shift+A'],
        Print: ['Ctrl+Cmd+F'],
      }),
    });

    const settings = await new SettingsManager('main', { platform: 'mac' }).load();

    expect(bindsOf(settings.keybinds)).toMatchObject({
      SwitchToTab1: ['CmdOrCtrl+1', 'Alt+1'],
      ViewContinuous: [],
      Find: ['CmdOrCtrl+F', 'Cmd+Shift+A'],
      MarkupToolbar: [],
      Print: ['Ctrl+Cmd+F'],
      Fullscreen: [],
      ViewSinglePage: ['CmdOrCtrl+2'],
    });
  });

  it('migrates once in the main window and remembers dropped defaults', async () => {
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybinds: storedBeforePreview({ SwitchToTab1: ['CmdOrCtrl+1', 'Alt+1'] }),
    });

    await new SettingsManager('main', { platform: 'mac' }).load();
    store.writes.length = 0;
    const settingsWindow = await new SettingsManager('settings', { platform: 'mac' }).load();
    const mainAgain = await new SettingsManager('main', { platform: 'mac' }).load();

    expect(store.writes).toEqual([]);
    expect(settingsWindow.keybinds.ViewContinuous.binds).toEqual([]);
    expect(mainAgain.keybinds.ViewContinuous.binds).toEqual([]);
    expect(mainAgain.keybinds.ViewSinglePage.binds).toEqual(['CmdOrCtrl+2']);
  });

  it('shows the upgrade to the Settings window before the main window stores it', async () => {
    store.reset({ storageSchemaVersion: SETTINGS_SCHEMA_VERSION, keybinds: storedBeforePreview() });

    const settings = await new SettingsManager('settings', { platform: 'other' }).load();

    expect(store.writes).toEqual([]);
    expect(settings.keybinds.FitToPage.binds).toEqual(['CmdOrCtrl+9']);
  });

  it('lets retired view-rotation bindings block no new default', async () => {
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybinds: {
        ...storedBeforePreview(),
        RotateClockwise: {
          displayName: 'Rotate Right',
          binds: ['CmdOrCtrl+2'],
          action: 'rotateRight',
        },
      },
    });

    const settings = await new SettingsManager('main', { platform: 'mac' }).load();

    expect(settings.keybinds.ViewSinglePage.binds).toEqual(['CmdOrCtrl+2']);
  });
});

describe('Rotate shortcuts behind the Page Rotation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.reset();
  });

  const closed = { platform: 'mac', pageRotationVerified: false } as const;
  const open = { platform: 'mac', pageRotationVerified: true } as const;

  it('offers no Rotate shortcut while Page Rotation is unverified', async () => {
    const settings = await new SettingsManager('main', closed).load();

    for (const { displayName } of Object.values(settings.keybinds))
      expect(displayName).not.toMatch(/Rotate/);
    expect(store.values.get('keybinds')).not.toHaveProperty('RotateLeft');
    expect(store.values.get('keybinds')).not.toHaveProperty('RotateRight');
  });

  it('gives a fresh install ⌘L Rotate Left and ⌘R Rotate Right once verified', async () => {
    const settings = await new SettingsManager('main', open).load();

    expect(settings.keybinds.RotateLeft).toEqual({
      displayName: 'Rotate Left',
      binds: ['CmdOrCtrl+L'],
      action: 'readerCommand',
      data: 'tools.rotate.left',
    });
    expect(settings.keybinds.RotateRight).toMatchObject({
      displayName: 'Rotate Right',
      binds: ['CmdOrCtrl+R'],
      data: 'tools.rotate.right',
    });
  });

  it('gives an install upgraded while the gate was closed the Rotate defaults when it opens', async () => {
    await new SettingsManager('main', closed).load();
    const settingsWindow = new SettingsManager('settings', closed);
    const edited = await settingsWindow.load();
    await settingsWindow.set('keybinds', {
      ...edited.keybinds,
      Find: { ...edited.keybinds.Find, binds: ['CmdOrCtrl+F', 'CmdOrCtrl+R'] },
    });

    const settings = await new SettingsManager('main', open).load();
    const settingsAfterward = await new SettingsManager('settings', open).load();

    expect(settings.keybinds.RotateLeft.binds).toEqual(['CmdOrCtrl+L']);
    // The reader chose ⌘R while Rotate was hidden; the new default gives way.
    expect(settings.keybinds.RotateRight.binds).toEqual([]);
    expect(settings.keybinds.Find.binds).toEqual(['CmdOrCtrl+F', 'CmdOrCtrl+R']);
    expect(store.values.get('keybinds')).toHaveProperty('RotateLeft');
    expect(settingsAfterward.keybinds.RotateLeft.binds).toEqual(['CmdOrCtrl+L']);
    expect(settingsAfterward.keybinds.RotateRight.binds).toEqual([]);
  });

  it('gives the Rotate defaults to an install a later version upgraded while the gate was closed', async () => {
    const { keybinds } = await new SettingsManager('main', closed).load();
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybindDefaultsVersion: 99,
      keybinds,
    });

    const settings = await new SettingsManager('main', open).load();

    expect(settings.keybinds.RotateLeft.binds).toEqual(['CmdOrCtrl+L']);
    expect(settings.keybinds.RotateRight.binds).toEqual(['CmdOrCtrl+R']);
    expect(store.values.get('keybinds')).toHaveProperty('RotateRight');
  });

  it('keeps a Rotate binding the reader changed after the gate opened', async () => {
    await new SettingsManager('main', open).load();
    const settingsWindow = new SettingsManager('settings', open);
    const edited = await settingsWindow.load();
    await settingsWindow.set('keybinds', {
      ...edited.keybinds,
      RotateLeft: { ...edited.keybinds.RotateLeft, binds: [] },
    });

    const settings = await new SettingsManager('main', open).load();

    expect(settings.keybinds.RotateLeft.binds).toEqual([]);
    expect(settings.keybinds.RotateRight.binds).toEqual(['CmdOrCtrl+R']);
  });

  it('hides stored Rotate shortcuts again if the gate is closed', async () => {
    await new SettingsManager('main', open).load();

    const settings = await new SettingsManager('settings', closed).load();

    expect(settings.keybinds).not.toHaveProperty('RotateLeft');
    expect(settings.keybinds).not.toHaveProperty('RotateRight');
  });

  it('lets retired view-rotation bindings block neither Rotate default', async () => {
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybindDefaultsVersion: 2,
      keybinds: {
        RotateClockwise: { displayName: 'Rotate', binds: ['CmdOrCtrl+R'], action: 'rotateRight' },
        RotateCounterClockwise: {
          displayName: 'Rotate',
          binds: ['CmdOrCtrl+L'],
          action: 'rotateLeft',
        },
      },
    });

    const settings = await new SettingsManager('main', { ...open, platform: 'other' }).load();

    expect(settings.keybinds.RotateLeft.binds).toEqual(['CmdOrCtrl+L']);
    expect(settings.keybinds.RotateRight.binds).toEqual(['CmdOrCtrl+R']);
    expect(settings.keybinds).not.toHaveProperty('RotateClockwise');
  });
});
