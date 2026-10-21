import { describe, expect, it, vi } from 'vitest';
import {
  type ChromePreferencesStorage,
  DEFAULT_CHROME_PREFERENCES,
  loadChromePreferences,
} from '../app/chrome-preferences';

function createStorage(initial?: unknown) {
  let stored = structuredClone(initial);
  const storage: ChromePreferencesStorage = {
    read: vi.fn(async () => structuredClone(stored)),
    write: vi.fn(async (value) => {
      stored = structuredClone(value);
    }),
  };
  return { storage, getStored: () => stored };
}

describe('Chrome preferences', () => {
  it('starts from defaults with the sidebar hidden on first launch', async () => {
    const { storage } = createStorage();
    const preferences = await loadChromePreferences(storage);

    expect(preferences.snapshot()).toEqual({
      sidebarVisible: false,
      sidebarMode: 'thumbnails',
      sidebarWidth: 220,
    });
    expect(DEFAULT_CHROME_PREFERENCES.sidebarVisible).toBe(false);
  });

  it('restores sidebar visibility, mode and width on the next launch', async () => {
    const backing = createStorage();
    const firstLaunch = await loadChromePreferences(backing.storage, { debounceMs: 0 });

    firstLaunch.update({ sidebarVisible: true, sidebarMode: 'thumbnails', sidebarWidth: 300 });
    await firstLaunch.flush();

    const nextLaunch = await loadChromePreferences(backing.storage);
    expect(nextLaunch.snapshot()).toEqual({
      sidebarVisible: true,
      sidebarMode: 'thumbnails',
      sidebarWidth: 300,
    });
    expect(backing.getStored()).toEqual({
      schemaVersion: 1,
      sidebarVisible: true,
      sidebarMode: 'thumbnails',
      sidebarWidth: 300,
    });
  });

  it('keeps every valid stored field and falls back per field for invalid ones', async () => {
    const { storage } = createStorage({
      schemaVersion: 1,
      sidebarVisible: true,
      sidebarMode: 'contact-sheet',
      sidebarWidth: 'wide',
    });

    const preferences = await loadChromePreferences(storage);

    expect(preferences.snapshot()).toEqual({
      sidebarVisible: true,
      sidebarMode: 'thumbnails',
      sidebarWidth: 220,
    });
  });

  it('bounds the sidebar width', async () => {
    const { storage } = createStorage({ schemaVersion: 1, sidebarWidth: 4000 });
    const preferences = await loadChromePreferences(storage);
    expect(preferences.snapshot().sidebarWidth).toBe(480);

    preferences.update({ sidebarWidth: 10 });
    expect(preferences.snapshot().sidebarWidth).toBe(140);
  });

  it('notifies observers of changes and coalesces writes', async () => {
    vi.useFakeTimers();
    try {
      const backing = createStorage();
      const preferences = await loadChromePreferences(backing.storage, { debounceMs: 200 });
      const observed: boolean[] = [];
      preferences.observe((snapshot) => observed.push(snapshot.sidebarVisible));

      preferences.update({ sidebarVisible: true });
      preferences.update({ sidebarWidth: 250 });
      preferences.update({ sidebarWidth: 260 });
      expect(observed).toEqual([true, true, true]);
      expect(backing.storage.write).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(backing.storage.write).toHaveBeenCalledTimes(1);
      expect(backing.getStored()).toMatchObject({ sidebarVisible: true, sidebarWidth: 260 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not notify or write when an update changes nothing', async () => {
    const backing = createStorage();
    const preferences = await loadChromePreferences(backing.storage, { debounceMs: 0 });
    const listener = vi.fn();
    preferences.observe(listener);

    preferences.update({ sidebarVisible: false });
    await preferences.flush();

    expect(listener).not.toHaveBeenCalled();
    expect(backing.storage.write).not.toHaveBeenCalled();
  });

  it('starts from defaults and reports when stored preferences cannot be read', async () => {
    const onPersistenceError = vi.fn();
    const storage: ChromePreferencesStorage = {
      read: vi.fn(async () => {
        throw new Error('disk unavailable');
      }),
      write: vi.fn(async () => undefined),
    };

    const preferences = await loadChromePreferences(storage, { onPersistenceError });

    expect(preferences.snapshot()).toEqual(DEFAULT_CHROME_PREFERENCES);
    expect(onPersistenceError).toHaveBeenCalledTimes(1);
  });

  it('reports a failed write and retries it on the next flush', async () => {
    const onPersistenceError = vi.fn();
    const backing = createStorage();
    vi.mocked(backing.storage.write).mockRejectedValueOnce(new Error('disk full'));
    const preferences = await loadChromePreferences(backing.storage, {
      debounceMs: 0,
      onPersistenceError,
    });

    preferences.update({ sidebarVisible: true });
    await expect(preferences.flush()).rejects.toThrow('disk full');
    expect(onPersistenceError).toHaveBeenCalledTimes(1);

    await preferences.flush();
    expect(backing.getStored()).toMatchObject({ sidebarVisible: true });
  });
});
