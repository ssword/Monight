import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    reset(initial: Record<string, unknown> = {}) {
      values.clear();
      for (const [key, value] of Object.entries(initial)) values.set(key, structuredClone(value));
    },
    load: vi.fn(async () => ({
      get: vi.fn(async (key: string) => structuredClone(values.get(key))),
      set: vi.fn(async (key: string, value: unknown) => {
        values.set(key, structuredClone(value));
      }),
      delete: vi.fn(async (key: string) => {
        values.delete(key);
      }),
      save: vi.fn(async () => undefined),
    })),
  };
});

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: store.load } }));

import { SETTINGS_SCHEMA_VERSION, SettingsManager } from '../scripts/settings';

describe('Add Bookmark shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.reset();
  });

  it.each([
    'mac',
    'other',
  ] as const)('gives a fresh %s install CmdOrCtrl+D for Tools > Add Bookmark', async (platform) => {
    const settings = await new SettingsManager('main', { platform }).load();

    expect(settings.keybinds.AddBookmark).toEqual({
      displayName: 'Add Bookmark',
      binds: ['CmdOrCtrl+D'],
      action: 'readerCommand',
      data: 'tools.bookmark',
    });
  });

  it('adds Add Bookmark to an install stored before it', async () => {
    const stored = structuredClone(
      (await new SettingsManager('main', { platform: 'other' }).load()).keybinds,
    );
    delete stored.AddBookmark;
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybinds: stored,
      keybindDefaultsVersion: 6,
    });

    const settings = await new SettingsManager('main', { platform: 'other' }).load();

    expect(settings.keybinds.AddBookmark.binds).toEqual(['CmdOrCtrl+D']);
  });

  it('drops the new default when the reader already chose that chord', async () => {
    const stored = structuredClone(
      (await new SettingsManager('main', { platform: 'mac' }).load()).keybinds,
    );
    delete stored.AddBookmark;
    stored.Print.binds = ['CmdOrCtrl+D'];
    store.reset({
      storageSchemaVersion: SETTINGS_SCHEMA_VERSION,
      keybinds: stored,
      keybindDefaultsVersion: 6,
    });

    const settings = await new SettingsManager('main', { platform: 'mac' }).load();

    expect(settings.keybinds.AddBookmark.binds).toEqual([]);
    expect(settings.keybinds.Print.binds).toEqual(['CmdOrCtrl+D']);
  });
});
