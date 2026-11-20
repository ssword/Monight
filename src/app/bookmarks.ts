// Bookmarks (CONTEXT.md): pages the reader has marked, kept per canonical
// Document path in their own durable store. They are reader-owned state:
// separate from the Reading Session and from Document edits, and never written
// into the PDF, so toggling one is not a Document edit.

export interface PersistedBookmarks {
  readonly schemaVersion: 1;
  /** Bookmarked pages (1-based) by canonical Document path. */
  readonly documents: Readonly<Record<string, readonly number[]>>;
}

export interface BookmarkStorage {
  read(): Promise<unknown>;
  write(value: PersistedBookmarks): Promise<void>;
}

export interface BookmarkAuthority {
  /** Bookmarked pages in page order; pages beyond `pageCount` are ignored, not deleted. */
  pages(filePath: string, pageCount?: number): number[];
  has(filePath: string, page: number): boolean;
  /** Adds the Bookmark, or removes it when the page already has one. */
  toggle(filePath: string, page: number): void;
  observe(listener: () => void): () => void;
  flush(): Promise<void>;
}

interface LoadBookmarksOptions {
  readonly debounceMs?: number;
  readonly onPersistenceError?: (error: unknown) => void;
}

const isPage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

function parseBookmarks(value: unknown): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  if (typeof value !== 'object' || value === null) return result;
  const documents = (value as { documents?: unknown }).documents;
  if (typeof documents !== 'object' || documents === null || Array.isArray(documents)) {
    return result;
  }
  for (const [filePath, pages] of Object.entries(documents)) {
    if (!Array.isArray(pages)) continue;
    const valid = new Set(pages.filter(isPage));
    if (valid.size > 0) result.set(filePath, valid);
  }
  return result;
}

export async function loadBookmarks(
  storage: BookmarkStorage,
  { debounceMs = 250, onPersistenceError }: LoadBookmarksOptions = {},
): Promise<BookmarkAuthority> {
  let current = new Map<string, Set<number>>();
  try {
    current = parseBookmarks(await storage.read());
  } catch (error) {
    onPersistenceError?.(error);
  }
  const listeners = new Set<() => void>();
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> | null = null;

  const write = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    await writing?.catch(() => undefined);
    if (!dirty) return;
    dirty = false;
    const persisted: PersistedBookmarks = {
      schemaVersion: 1,
      documents: Object.fromEntries(
        [...current].map(([filePath, pages]) => [filePath, [...pages].sort((a, b) => a - b)]),
      ),
    };
    writing = storage.write(persisted);
    try {
      await writing;
    } catch (error) {
      dirty = true;
      onPersistenceError?.(error);
      throw error;
    } finally {
      writing = null;
    }
  };

  return {
    pages: (filePath, pageCount) =>
      [...(current.get(filePath) ?? [])]
        .filter((page) => pageCount === undefined || page <= pageCount)
        .sort((a, b) => a - b),
    has: (filePath, page) => current.get(filePath)?.has(page) ?? false,
    toggle(filePath, page) {
      if (!isPage(page)) return;
      const next = new Set(current.get(filePath));
      if (!next.delete(page)) next.add(page);
      current = new Map(current);
      if (next.size > 0) current.set(filePath, next);
      else current.delete(filePath);
      dirty = true;
      for (const listener of listeners) listener();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void write().catch(() => undefined);
      }, debounceMs);
    },
    observe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: write,
  };
}
