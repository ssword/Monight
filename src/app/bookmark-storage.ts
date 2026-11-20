import { Store } from '@tauri-apps/plugin-store';
import type { BookmarkStorage, PersistedBookmarks } from './bookmarks';

/** Bookmarks live in a dedicated store, never in settings.json, the Reading Session or the PDF. */
export function createBookmarkStorage(): BookmarkStorage {
  let store: Store | null = null;

  const getStore = async (): Promise<Store> => {
    if (!store) store = await Store.load('bookmarks.json');
    return store;
  };

  return {
    async read() {
      return await (await getStore()).get('bookmarks');
    },
    async write(bookmarks: PersistedBookmarks) {
      const bookmarkStore = await getStore();
      await bookmarkStore.set('bookmarks', bookmarks);
      await bookmarkStore.save();
    },
  };
}
