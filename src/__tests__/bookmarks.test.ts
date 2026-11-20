import { describe, expect, it, vi } from 'vitest';
import { type BookmarkStorage, loadBookmarks, type PersistedBookmarks } from '../app/bookmarks';

function memoryStorage(initial?: unknown) {
  let stored: unknown = initial;
  const storage: BookmarkStorage = {
    read: async () => structuredClone(stored),
    write: async (value) => {
      stored = structuredClone(value);
    },
  };
  return { storage, stored: () => stored };
}

describe('Bookmark store', () => {
  it('toggles a page on and off, listing pages in page order', async () => {
    const bookmarks = await loadBookmarks(memoryStorage().storage);

    bookmarks.toggle('/docs/a.pdf', 5);
    bookmarks.toggle('/docs/a.pdf', 2);
    expect(bookmarks.pages('/docs/a.pdf')).toEqual([2, 5]);
    expect(bookmarks.has('/docs/a.pdf', 5)).toBe(true);

    bookmarks.toggle('/docs/a.pdf', 5);
    expect(bookmarks.pages('/docs/a.pdf')).toEqual([2]);
    expect(bookmarks.has('/docs/a.pdf', 5)).toBe(false);
  });

  it('keeps Bookmarks separate per Document path and notifies observers', async () => {
    const bookmarks = await loadBookmarks(memoryStorage().storage);
    const listener = vi.fn();
    bookmarks.observe(listener);

    bookmarks.toggle('/docs/a.pdf', 1);

    expect(bookmarks.pages('/docs/b.pdf')).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('survives a relaunch through its storage', async () => {
    const { storage, stored } = memoryStorage();
    const first = await loadBookmarks(storage, { debounceMs: 0 });
    first.toggle('/docs/a.pdf', 3);
    await first.flush();

    expect(stored()).toEqual({
      schemaVersion: 1,
      documents: { '/docs/a.pdf': [3] },
    } satisfies PersistedBookmarks);
    const next = await loadBookmarks(storage);
    expect(next.pages('/docs/a.pdf')).toEqual([3]);
  });

  it('ignores pages beyond the page count when read, without deleting them', async () => {
    const { storage, stored } = memoryStorage();
    const bookmarks = await loadBookmarks(storage, { debounceMs: 0 });
    bookmarks.toggle('/docs/a.pdf', 2);
    bookmarks.toggle('/docs/a.pdf', 9);

    expect(bookmarks.pages('/docs/a.pdf', 4)).toEqual([2]);
    await bookmarks.flush();
    expect(stored()).toMatchObject({ documents: { '/docs/a.pdf': [2, 9] } });
  });

  it('falls back to no Bookmarks when storage is corrupt or unreadable', async () => {
    for (const corrupt of ['junk', 7, { documents: 'x' }, { schemaVersion: 1, documents: [] }]) {
      const bookmarks = await loadBookmarks(memoryStorage(corrupt).storage);
      expect(bookmarks.pages('/docs/a.pdf')).toEqual([]);
    }
    const onPersistenceError = vi.fn();
    const failing: BookmarkStorage = {
      read: async () => {
        throw new Error('disk');
      },
      write: async () => undefined,
    };
    const bookmarks = await loadBookmarks(failing, { onPersistenceError });
    expect(bookmarks.pages('/docs/a.pdf')).toEqual([]);
    expect(onPersistenceError).toHaveBeenCalled();
  });

  it('drops invalid stored entries but keeps valid ones', async () => {
    const bookmarks = await loadBookmarks(
      memoryStorage({
        schemaVersion: 1,
        documents: { '/docs/a.pdf': [3, 'x', -1, 0, 1.5, 3, 1], '/docs/b.pdf': 'no' },
      }).storage,
    );
    expect(bookmarks.pages('/docs/a.pdf')).toEqual([1, 3]);
    expect(bookmarks.pages('/docs/b.pdf')).toEqual([]);
  });
});
