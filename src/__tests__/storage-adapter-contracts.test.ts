import { describe, expect, it, vi } from 'vitest';

const tauriStores = vi.hoisted(() => {
  const values = new Map<string, Map<string, unknown>>();
  const load = vi.fn(async (fileName: string) => {
    let store = values.get(fileName);
    if (!store) {
      store = new Map();
      values.set(fileName, store);
    }
    return {
      get: vi.fn(async (key: string) => structuredClone(store?.get(key))),
      set: vi.fn(async (key: string, value: unknown) => {
        store?.set(key, structuredClone(value));
      }),
      save: vi.fn(async () => undefined),
    };
  });
  return { load, values };
});

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: tauriStores.load } }));

import { createAnnotationStorage } from '../app/annotation-storage';
import { createReadingSessionStorage } from '../app/reading-session-storage';
import { createRecentDocumentStorage } from '../app/recent-document-storage';
import type { AnnotationStorage, PersistedAnnotations } from '../reader/annotations';
import type { PersistedReadingSession } from '../reader/reader-actions';
import type { ReadingSessionStorage } from '../reader/reading-session-store';
import type { PersistedRecentDocuments, RecentDocumentStorage } from '../reader/recent-documents';

interface StorageContract<T> {
  read(): Promise<unknown>;
  write(value: T): Promise<void>;
  readLegacy(): Promise<unknown>;
  removeLegacy(): Promise<void>;
}

interface StorageHarness<T> {
  readonly storage: StorageContract<T>;
  readonly initial: T;
  readonly replacement: T;
  readonly legacy: unknown;
}

function expectStorageContract<T>(name: string, createHarness: () => StorageHarness<T>): void {
  describe(name, () => {
    it('reads and replaces its dedicated value', async () => {
      const { storage, initial, replacement } = createHarness();

      await expect(storage.read()).resolves.toEqual(initial);
      await storage.write(replacement);

      await expect(storage.read()).resolves.toEqual(replacement);
    });

    it('exposes and removes the legacy value through the migration boundary', async () => {
      const { storage, legacy } = createHarness();

      await expect(storage.readLegacy()).resolves.toEqual(legacy);
      await storage.removeLegacy();

      await expect(storage.readLegacy()).resolves.toBeUndefined();
    });
  });
}

function createInMemoryStorage<T>(initial: T, legacy: unknown): StorageContract<T> {
  let stored: unknown = structuredClone(initial);
  let legacyValue = structuredClone(legacy);
  return {
    async read() {
      return structuredClone(stored);
    },
    async write(value) {
      stored = structuredClone(value);
    },
    async readLegacy() {
      return structuredClone(legacyValue);
    },
    async removeLegacy() {
      legacyValue = undefined;
    },
  };
}

function createLegacyValue(initial: unknown) {
  let value = structuredClone(initial);
  return {
    read: async () => structuredClone(value),
    remove: async () => {
      value = undefined;
    },
  };
}

const initialReadingSession: PersistedReadingSession = {
  schemaVersion: 2,
  activeDocumentPath: null,
  documents: [],
};
const replacementReadingSession: PersistedReadingSession = {
  schemaVersion: 2,
  activeDocumentPath: '/docs/report.pdf',
  documents: [
    {
      filePath: '/docs/report.pdf',
      title: 'report.pdf',
      readingPosition: { page: 4, location: 0.25 },
    },
  ],
};
const legacyReadingSession = { activeFilePath: '/docs/legacy.pdf', tabs: [] };

const initialAnnotations: PersistedAnnotations = { schemaVersion: 1, documents: {} };
const replacementAnnotations: PersistedAnnotations = {
  schemaVersion: 1,
  documents: { '/docs/report.pdf': [] },
};
const legacyAnnotations = { '/docs/legacy.pdf': [] };

const initialRecentDocuments: PersistedRecentDocuments = { schemaVersion: 1, documents: [] };
const replacementRecentDocuments: PersistedRecentDocuments = {
  schemaVersion: 1,
  documents: [{ filePath: '/docs/report.pdf', title: 'report.pdf', openedAt: 10 }],
};
const legacyRecentDocuments = [{ filePath: '/docs/legacy.pdf', title: 'legacy.pdf', openedAt: 5 }];

describe('Reading Session storage contract', () => {
  expectStorageContract('in-memory adapter', () => ({
    storage: createInMemoryStorage(initialReadingSession, legacyReadingSession),
    initial: initialReadingSession,
    replacement: replacementReadingSession,
    legacy: legacyReadingSession,
  }));

  expectStorageContract('production adapter', () => {
    let stored: unknown = structuredClone(initialReadingSession);
    const legacy = createLegacyValue(legacyReadingSession);
    const storage: ReadingSessionStorage = createReadingSessionStorage({
      readPersistedReadingSession: async () => structuredClone(stored),
      writePersistedReadingSession: async (value: PersistedReadingSession) => {
        stored = structuredClone(value);
      },
      readLegacyReadingSession: legacy.read,
      removeLegacyReadingSession: legacy.remove,
    });
    return {
      storage,
      initial: initialReadingSession,
      replacement: replacementReadingSession,
      legacy: legacyReadingSession,
    };
  });
});

describe('Annotation storage contract', () => {
  expectStorageContract('in-memory adapter', () => ({
    storage: createInMemoryStorage(initialAnnotations, legacyAnnotations),
    initial: initialAnnotations,
    replacement: replacementAnnotations,
    legacy: legacyAnnotations,
  }));

  expectStorageContract('production adapter', () => {
    tauriStores.values.set(
      'annotations.json',
      new Map([['annotations', structuredClone(initialAnnotations)]]),
    );
    const legacy = createLegacyValue(legacyAnnotations);
    const storage: AnnotationStorage = createAnnotationStorage({
      readLegacyAnnotations: legacy.read,
      removeLegacyAnnotations: legacy.remove,
    });
    return {
      storage,
      initial: initialAnnotations,
      replacement: replacementAnnotations,
      legacy: legacyAnnotations,
    };
  });
});

describe('Recent Document storage contract', () => {
  expectStorageContract('in-memory adapter', () => ({
    storage: createInMemoryStorage(initialRecentDocuments, legacyRecentDocuments),
    initial: initialRecentDocuments,
    replacement: replacementRecentDocuments,
    legacy: legacyRecentDocuments,
  }));

  expectStorageContract('production adapter', () => {
    tauriStores.values.set(
      'recent-documents.json',
      new Map([['recentDocuments', structuredClone(initialRecentDocuments)]]),
    );
    const legacy = createLegacyValue(legacyRecentDocuments);
    const storage: RecentDocumentStorage = createRecentDocumentStorage({
      readLegacyRecentDocuments: legacy.read,
      removeLegacyRecentDocuments: legacy.remove,
    });
    return {
      storage,
      initial: initialRecentDocuments,
      replacement: replacementRecentDocuments,
      legacy: legacyRecentDocuments,
    };
  });
});
