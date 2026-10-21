import { Store } from '@tauri-apps/plugin-store';
import type { ChromePreferencesStorage, PersistedChromePreferences } from './chrome-preferences';

/** Chrome preferences live in a dedicated store, never in settings.json or the Reading Session. */
export function createChromePreferencesStorage(): ChromePreferencesStorage {
  let store: Store | null = null;

  const getStore = async (): Promise<Store> => {
    if (!store) store = await Store.load('chrome-preferences.json');
    return store;
  };

  return {
    async read() {
      return await (await getStore()).get('chromePreferences');
    },
    async write(preferences: PersistedChromePreferences) {
      const preferencesStore = await getStore();
      await preferencesStore.set('chromePreferences', preferences);
      await preferencesStore.save();
    },
  };
}
