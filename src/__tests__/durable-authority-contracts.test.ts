import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface DeferredOperation {
  readonly started: Promise<void>;
  waitForRelease(): Promise<void>;
  release(): void;
}

interface StoreBackend {
  get(): Promise<unknown>;
  set(value: unknown): Promise<void>;
}

const tauriStores = vi.hoisted(() => {
  const backends = new Map<string, StoreBackend>();
  const load = vi.fn(async (fileName: string) => {
    const backend = backends.get(fileName);
    if (!backend) throw new Error(`Missing test store: ${fileName}`);
    return {
      get: () => backend.get(),
      set: (_key: string, value: unknown) => backend.set(value),
      async save() {},
    };
  });
  return { backends, load };
});

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: tauriStores.load } }));

import { createAnnotationStorage } from '../app/annotation-storage';
import { createRecentDocumentStorage } from '../app/recent-document-storage';
import type { PdfAnnotation } from '../lib/document-features';
import {
  type AnnotationAuthority,
  type AnnotationStorage,
  loadAnnotations,
  type PersistedAnnotations,
} from '../reader/annotations';
import {
  loadRecentDocuments,
  type PersistedRecentDocuments,
  type RecentDocumentAuthority,
  type RecentDocumentStorage,
} from '../reader/recent-documents';

interface Storage<T> {
  read(): Promise<unknown>;
  write(value: T): Promise<void>;
  readLegacy(): Promise<unknown>;
  removeLegacy(): Promise<void>;
}

interface StorageDriver<T> {
  readonly storage: Storage<T>;
  getStored(): unknown;
  getLegacy(): unknown;
  getReadCount(): number;
  getWriteAttempts(): number;
  getWrites(): readonly T[];
  getCleanupAttempts(): number;
  failNextRead(error: Error): void;
  failNextWrite(error: Error): void;
  failNextCleanup(error: Error): void;
  replaceValueAfterNextWrite(value: T): void;
  deferNextRead(): DeferredOperation;
  deferNextWrite(): DeferredOperation;
}

interface AuthorityAdapter {
  snapshot(): unknown;
  change(marker: number): void;
  clear(): void;
  flush(): Promise<void>;
  isDirty(): boolean;
}

interface LoadOptions {
  readonly debounceMs?: number;
  readonly retryMs?: number;
  readonly onPersistenceError?: (error: unknown) => void;
  readonly onChanged?: () => void;
  readonly onObserverError?: (error: unknown) => void;
}

interface AuthorityContract<T> {
  readonly name: string;
  dedicatedValue(marker: number): T;
  legacyValue(marker: number): unknown;
  unsupportedValue(): unknown;
  expectedSnapshot(marker: number): unknown;
  load(storage: Storage<T>, options?: LoadOptions): Promise<AuthorityAdapter>;
  createProductionStorage(initial?: unknown, legacy?: unknown): StorageDriver<T>;
}

function deferredOperation(): DeferredOperation {
  let releaseStarted: () => void = () => undefined;
  let releaseWrite: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    releaseStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  return {
    started,
    async waitForRelease() {
      releaseStarted();
      await blocked;
    },
    release: releaseWrite,
  };
}

function createControlledStorage<T>(initial?: unknown, legacy?: unknown) {
  let stored = structuredClone(initial);
  let legacyStored = structuredClone(legacy);
  let readCount = 0;
  let writeAttempts = 0;
  let cleanupAttempts = 0;
  const writes: T[] = [];
  const readFailures: Error[] = [];
  const writeFailures: Error[] = [];
  const cleanupFailures: Error[] = [];
  let pendingRead: DeferredOperation | null = null;
  let pendingWrite: DeferredOperation | null = null;
  let replacementAfterWrite: T | undefined;
  let shouldReplaceAfterWrite = false;

  const read = async (): Promise<unknown> => {
    readCount += 1;
    const failure = readFailures.shift();
    if (failure) throw failure;
    const deferred = pendingRead;
    pendingRead = null;
    if (deferred) await deferred.waitForRelease();
    return structuredClone(stored);
  };
  const write = async (value: T): Promise<void> => {
    writeAttempts += 1;
    const failure = writeFailures.shift();
    if (failure) throw failure;
    const deferred = pendingWrite;
    pendingWrite = null;
    if (deferred) await deferred.waitForRelease();
    stored = structuredClone(value);
    writes.push(structuredClone(value));
    if (shouldReplaceAfterWrite) {
      stored = structuredClone(replacementAfterWrite);
      shouldReplaceAfterWrite = false;
    }
  };
  const readLegacy = async (): Promise<unknown> => structuredClone(legacyStored);
  const removeLegacy = async (): Promise<void> => {
    cleanupAttempts += 1;
    const failure = cleanupFailures.shift();
    if (failure) throw failure;
    legacyStored = undefined;
  };

  const driver = (storage: Storage<T>): StorageDriver<T> => ({
    storage,
    getStored: () => structuredClone(stored),
    getLegacy: () => structuredClone(legacyStored),
    getReadCount: () => readCount,
    getWriteAttempts: () => writeAttempts,
    getWrites: () => structuredClone(writes),
    getCleanupAttempts: () => cleanupAttempts,
    failNextRead: (error) => readFailures.push(error),
    failNextWrite: (error) => writeFailures.push(error),
    failNextCleanup: (error) => cleanupFailures.push(error),
    replaceValueAfterNextWrite(value) {
      replacementAfterWrite = structuredClone(value);
      shouldReplaceAfterWrite = true;
    },
    deferNextRead() {
      pendingRead = deferredOperation();
      return pendingRead;
    },
    deferNextWrite() {
      pendingWrite = deferredOperation();
      return pendingWrite;
    },
  });

  return { read, write, readLegacy, removeLegacy, driver };
}

function createFakeStorage<T>(initial?: unknown, legacy?: unknown): StorageDriver<T> {
  const controlled = createControlledStorage<T>(initial, legacy);
  const storage: Storage<T> = {
    read: controlled.read,
    write: controlled.write,
    readLegacy: controlled.readLegacy,
    removeLegacy: controlled.removeLegacy,
  };
  return controlled.driver(storage);
}

function createProductionStorage<T>(
  fileName: string,
  initial: unknown,
  legacy: unknown,
  createStorage: (legacyAdapter: {
    read(): Promise<unknown>;
    remove(): Promise<void>;
  }) => Storage<T>,
): StorageDriver<T> {
  const controlled = createControlledStorage<T>(initial, legacy);
  tauriStores.backends.set(fileName, {
    get: controlled.read,
    set: (value) => controlled.write(value as T),
  });
  const storage = createStorage({
    read: controlled.readLegacy,
    remove: controlled.removeLegacy,
  });
  return controlled.driver(storage);
}

const DOCUMENT_PATH = '/docs/report.pdf';

function annotation(marker: number): PdfAnnotation {
  return {
    id: 'highlight-1',
    kind: 'highlight',
    pageNumber: 4,
    rects: [{ x1: 10, y1: 20, x2: 30, y2: 40 }],
    text: 'Moonlight',
    note: `note-${marker}`,
    color: 'yellow',
    createdAt: 10,
    updatedAt: marker,
  };
}

const annotationContract: AuthorityContract<PersistedAnnotations> = {
  name: 'Annotations',
  dedicatedValue: (marker) => ({
    schemaVersion: 1,
    documents: { [DOCUMENT_PATH]: [annotation(marker)] },
  }),
  legacyValue: (marker) => ({ [DOCUMENT_PATH]: [annotation(marker)] }),
  unsupportedValue: () => ({ schemaVersion: 2, documents: {} }),
  expectedSnapshot: (marker) => [annotation(marker)],
  async load(storage, options = {}) {
    const authority: AnnotationAuthority = await loadAnnotations(storage as AnnotationStorage, {
      ...options,
      onChanged: options.onChanged ? () => options.onChanged?.() : undefined,
    });
    return {
      snapshot: () => authority.snapshot(DOCUMENT_PATH),
      change: (marker) => authority.replace(DOCUMENT_PATH, [annotation(marker)]),
      clear: () => authority.clear(),
      flush: () => authority.flush(),
      isDirty: () => authority.isDirty(),
    };
  },
  createProductionStorage: (initial, legacy) =>
    createProductionStorage('annotations.json', initial, legacy, (legacyAdapter) =>
      createAnnotationStorage({
        readLegacyAnnotations: legacyAdapter.read,
        removeLegacyAnnotations: legacyAdapter.remove,
      }),
    ),
};

function recentDocument(marker: number) {
  return {
    filePath: DOCUMENT_PATH,
    title: `report-${marker}.pdf`,
    openedAt: marker,
  };
}

const recentDocumentContract: AuthorityContract<PersistedRecentDocuments> = {
  name: 'Recent Documents',
  dedicatedValue: (marker) => ({ schemaVersion: 1, documents: [recentDocument(marker)] }),
  legacyValue: (marker) => [recentDocument(marker)],
  unsupportedValue: () => ({ schemaVersion: 2, documents: [] }),
  expectedSnapshot: (marker) => [recentDocument(marker)],
  async load(storage, options = {}) {
    const authority: RecentDocumentAuthority = await loadRecentDocuments(
      storage as RecentDocumentStorage,
      {
        ...options,
        onChanged: options.onChanged ? () => options.onChanged?.() : undefined,
      },
    );
    return {
      snapshot: () => authority.snapshot(),
      change: (marker) => authority.record(recentDocument(marker)),
      clear: () => authority.clear(),
      flush: () => authority.flush(),
      isDirty: () => authority.isDirty(),
    };
  },
  createProductionStorage: (initial, legacy) =>
    createProductionStorage('recent-documents.json', initial, legacy, (legacyAdapter) =>
      createRecentDocumentStorage({
        readLegacyRecentDocuments: legacyAdapter.read,
        removeLegacyRecentDocuments: legacyAdapter.remove,
      }),
    ),
};

const storageFactories = [
  {
    name: 'fake store',
    create: <T>(_contract: AuthorityContract<T>, initial?: unknown, legacy?: unknown) =>
      createFakeStorage<T>(initial, legacy),
  },
  {
    name: 'production adapter store',
    create: <T>(contract: AuthorityContract<T>, initial?: unknown, legacy?: unknown) =>
      contract.createProductionStorage(initial, legacy),
  },
] as const;

interface IsolationFixture {
  readonly annotationBacking: StorageDriver<PersistedAnnotations>;
  readonly recentBacking: StorageDriver<PersistedRecentDocuments>;
  readonly annotations: AuthorityAdapter;
  readonly recentDocuments: AuthorityAdapter;
}

const isolationCases = [
  {
    name: 'Annotations',
    select: (fixture: IsolationFixture) => ({
      failingBacking: fixture.annotationBacking,
      failingAuthority: fixture.annotations,
      independentBacking: fixture.recentBacking,
      independentAuthority: fixture.recentDocuments,
    }),
  },
  {
    name: 'Recent Documents',
    select: (fixture: IsolationFixture) => ({
      failingBacking: fixture.recentBacking,
      failingAuthority: fixture.recentDocuments,
      independentBacking: fixture.annotationBacking,
      independentAuthority: fixture.annotations,
    }),
  },
] as const;

function runAuthorityContract<T>(contract: AuthorityContract<T>): void {
  for (const storageFactory of storageFactories) {
    describe(`${contract.name} with ${storageFactory.name}`, () => {
      it('coalesces bursts and flushes the latest revision', async () => {
        vi.useFakeTimers();
        const backing = storageFactory.create(contract);
        const authority = await contract.load(backing.storage, { debounceMs: 50 });

        authority.change(1);
        authority.change(2);
        authority.change(3);
        await vi.advanceTimersByTimeAsync(49);
        expect(backing.getWriteAttempts()).toBe(0);

        await authority.flush();

        expect(backing.getWrites()).toEqual([contract.dedicatedValue(3)]);
        expect(authority.snapshot()).toEqual(contract.expectedSnapshot(3));
        expect(authority.isDirty()).toBe(false);
      });

      it('retries a failed write without losing dirty state', async () => {
        vi.useFakeTimers();
        const backing = storageFactory.create(contract);
        backing.failNextWrite(new Error('store unavailable'));
        const onPersistenceError = vi.fn();
        const authority = await contract.load(backing.storage, {
          debounceMs: 0,
          retryMs: 50,
          onPersistenceError,
        });

        authority.change(1);
        await vi.advanceTimersByTimeAsync(0);
        expect(authority.isDirty()).toBe(true);
        expect(onPersistenceError).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(50);

        expect(backing.getWriteAttempts()).toBe(2);
        expect(backing.getStored()).toEqual(contract.dedicatedValue(1));
        expect(authority.isDirty()).toBe(false);
      });

      it('persists a newer mutation that arrives during an older write', async () => {
        const backing = storageFactory.create(contract);
        const pendingWrite = backing.deferNextWrite();
        const authority = await contract.load(backing.storage, { debounceMs: 60_000 });

        authority.change(1);
        const flush = authority.flush();
        await pendingWrite.started;
        authority.change(2);
        pendingWrite.release();
        await flush;

        expect(backing.getWrites()).toEqual([
          contract.dedicatedValue(1),
          contract.dedicatedValue(2),
        ]);
        expect(backing.getStored()).toEqual(contract.dedicatedValue(2));
        expect(authority.isDirty()).toBe(false);
      });

      it('reconciles an uncertain read without overwriting the durable value', async () => {
        vi.useFakeTimers();
        const backing = storageFactory.create(contract, contract.dedicatedValue(1));
        backing.failNextRead(new Error('temporary read failure'));
        const authority = await contract.load(backing.storage, { retryMs: 50 });

        expect(authority.isDirty()).toBe(true);
        await vi.advanceTimersByTimeAsync(50);

        expect(authority.snapshot()).toEqual(contract.expectedSnapshot(1));
        expect(backing.getWriteAttempts()).toBe(0);
        expect(authority.isDirty()).toBe(false);
      });

      it('does not let a stale uncertain read replace a newer mutation', async () => {
        const backing = storageFactory.create(contract, contract.dedicatedValue(1));
        backing.failNextRead(new Error('temporary read failure'));
        const authority = await contract.load(backing.storage, { retryMs: 60_000 });
        const pendingRead = backing.deferNextRead();

        const flush = authority.flush();
        await pendingRead.started;
        authority.change(2);
        pendingRead.release();

        await expect(flush).rejects.toThrow(/could not be reconciled/);
        expect(authority.snapshot()).toEqual(contract.expectedSnapshot(2));
        expect(backing.getStored()).toEqual(contract.dedicatedValue(1));
        expect(backing.getWriteAttempts()).toBe(0);
        expect(authority.isDirty()).toBe(true);
      });

      it('treats a durable conflict as non-retryable', async () => {
        vi.useFakeTimers();
        const backing = storageFactory.create(contract, contract.unsupportedValue());
        const authority = await contract.load(backing.storage, {
          debounceMs: 0,
          retryMs: 50,
        });
        authority.change(1);

        await expect(authority.flush()).rejects.toThrow(/Dedicated .* state is invalid/);
        const readsAfterConflict = backing.getReadCount();
        await vi.advanceTimersByTimeAsync(100);

        expect(backing.getReadCount()).toBe(readsAfterConflict);
        expect(backing.getWriteAttempts()).toBe(0);
        expect(authority.isDirty()).toBe(true);
      });

      it('verifies migration before removing the legacy value', async () => {
        const backing = storageFactory.create(contract, undefined, contract.legacyValue(1));

        const authority = await contract.load(backing.storage);

        expect(authority.snapshot()).toEqual(contract.expectedSnapshot(1));
        expect(backing.getStored()).toEqual(contract.dedicatedValue(1));
        expect(backing.getLegacy()).toBeUndefined();
        expect(backing.getCleanupAttempts()).toBe(1);
      });

      it('does not overwrite a conflicting value observed during migration verification', async () => {
        const conflicting = contract.dedicatedValue(2);
        const backing = storageFactory.create(contract, undefined, contract.legacyValue(1));
        backing.replaceValueAfterNextWrite(conflicting);
        const authority = await contract.load(backing.storage, { retryMs: 60_000 });

        expect(authority.snapshot()).toEqual(contract.expectedSnapshot(1));
        expect(authority.isDirty()).toBe(true);
        await expect(authority.flush()).rejects.toThrow(/could not be reconciled/);

        expect(backing.getStored()).toEqual(conflicting);
        expect(backing.getWriteAttempts()).toBe(1);
        expect(backing.getLegacy()).toEqual(contract.legacyValue(1));
      });

      it('recovers from failed legacy cleanup after a later change', async () => {
        const backing = storageFactory.create(contract, undefined, contract.legacyValue(1));
        backing.failNextCleanup(new Error('legacy store busy'));
        const authority = await contract.load(backing.storage, { debounceMs: 60_000 });

        expect(backing.getLegacy()).toEqual(contract.legacyValue(1));
        authority.change(2);
        await authority.flush();

        expect(backing.getLegacy()).toBeUndefined();
        expect(backing.getCleanupAttempts()).toBe(2);
        expect(backing.getStored()).toEqual(contract.dedicatedValue(2));
      });

      it('isolates observer failures from state and persistence', async () => {
        const backing = storageFactory.create(contract);
        const onObserverError = vi.fn();
        const authority = await contract.load(backing.storage, {
          debounceMs: 60_000,
          onChanged: () => {
            throw new Error('observer failed');
          },
          onObserverError,
        });

        expect(() => authority.change(1)).not.toThrow();
        await authority.flush();

        expect(authority.snapshot()).toEqual(contract.expectedSnapshot(1));
        expect(backing.getStored()).toEqual(contract.dedicatedValue(1));
        expect(onObserverError).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'observer failed' }),
        );
      });
    });
  }
}

describe('Durable authority persistence contracts', () => {
  beforeEach(() => {
    tauriStores.backends.clear();
    tauriStores.load.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  runAuthorityContract(annotationContract);
  runAuthorityContract(recentDocumentContract);

  for (const isolationCase of isolationCases) {
    it(`${isolationCase.name} clear failure cannot alter the other authority`, async () => {
      const annotationBacking = createFakeStorage<PersistedAnnotations>();
      const recentBacking = createFakeStorage<PersistedRecentDocuments>();
      const annotations = await annotationContract.load(annotationBacking.storage, {
        debounceMs: 60_000,
      });
      const recentDocuments = await recentDocumentContract.load(recentBacking.storage, {
        debounceMs: 60_000,
      });
      annotations.change(1);
      recentDocuments.change(1);
      await annotations.flush();
      await recentDocuments.flush();

      const { failingBacking, failingAuthority, independentBacking, independentAuthority } =
        isolationCase.select({
          annotationBacking,
          recentBacking,
          annotations,
          recentDocuments,
        });
      const independentSnapshot = independentAuthority.snapshot();
      const independentStored = independentBacking.getStored();
      failingBacking.failNextWrite(new Error('store unavailable'));

      failingAuthority.clear();
      await expect(failingAuthority.flush()).rejects.toThrow('store unavailable');

      expect(independentAuthority.snapshot()).toEqual(independentSnapshot);
      expect(independentBacking.getStored()).toEqual(independentStored);
    });
  }
});
