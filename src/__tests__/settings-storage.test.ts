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

const legacySession = {
  version: 1,
  activeFilePath: '/books/one.pdf',
  tabs: [
    {
      filePath: '/books/one.pdf',
      title: 'one.pdf',
      currentPage: 4,
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

  it('migrates the legacy blob once into independently versioned concern keys', async () => {
    const legacy = {
      version: '1.0.6',
      general: { ...DEFAULT_SETTINGS.general, displayThumbs: false },
      keybinds: {
        ...DEFAULT_SETTINGS.keybinds,
        OpenFile: { ...DEFAULT_SETTINGS.keybinds.OpenFile, binds: ['Ctrl+Shift+O'] },
      },
      lastSession: legacySession,
      recentFiles: [{ filePath: '/books/one.pdf', title: 'one.pdf', openedAt: 42 }],
      annotations: { '/books/one.pdf': [{ id: 'note-1', pageNumber: 4 }] },
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

    expect(settings.general.displayThumbs).toBe(false);
    expect(settings.keybinds.OpenFile.binds).toEqual(['Ctrl+Shift+O']);
    expect(settings.recentFiles).toEqual(legacy.recentFiles);
    expect(settings.annotations).toEqual(legacy.annotations);
    expect(settings.lastFilter).toEqual(legacy.lastFilter);
    expect(store.values.get('readingSession')).toEqual({
      schemaVersion: 1,
      activeDocumentPath: '/books/one.pdf',
      documents: [
        expect.objectContaining({
          filePath: '/books/one.pdf',
          title: 'one.pdf',
          readingPosition: { page: 4, location: 0 },
        }),
      ],
    });
    expect(store.values.get('storageSchemaVersion')).toBe(SETTINGS_SCHEMA_VERSION);
    expect(store.values.has('settings')).toBe(false);

    store.writes.length = 0;
    await new SettingsManager('settings').load();
    expect(store.writes).toEqual([]);
  });

  it('writes only the requested concern and rejects keys not owned by the window', async () => {
    const settingsWindow = new SettingsManager('settings');
    await settingsWindow.load();
    store.writes.length = 0;

    await settingsWindow.set('general', {
      ...DEFAULT_SETTINGS.general,
      displayThumbs: false,
    });

    expect(store.writes).toEqual(['general']);
    await expect(
      // @ts-expect-error verifies runtime discipline for untyped callers too
      settingsWindow.set('annotations', {}),
    ).rejects.toThrow('Settings window cannot write annotations');

    const mainWindow = new SettingsManager('main');
    await mainWindow.load();
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
      schemaVersion: 1,
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

  it('clears only reading history concerns from the main window', async () => {
    const mainWindow = new SettingsManager('main');
    await mainWindow.load();
    await mainWindow.set('recentFiles', [
      { filePath: '/books/one.pdf', title: 'one.pdf', openedAt: 42 },
    ]);
    await mainWindow.set('annotations', { '/books/one.pdf': [] });
    await mainWindow.writePersistedReadingSession({
      schemaVersion: 1,
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
    await mainWindow.clearReadingHistory();

    expect(store.values.get('recentFiles')).toEqual([]);
    expect(store.values.get('annotations')).toEqual({});
    expect(store.values.get('readingSession')).toEqual({
      schemaVersion: 1,
      activeDocumentPath: null,
      documents: [],
    });
    expect(store.values.get('keybinds')).toEqual(keybinds);
    expect(store.values.get('general')).toEqual(general);
    expect(store.writes).toEqual(['recentFiles', 'readingSession', 'annotations']);
  });
});
