import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadRecentDocuments,
  type PersistedRecentDocuments,
  type RecentDocumentStorage,
} from '../reader/recent-documents';

function recentDocument(filePath: string, openedAt: number) {
  return {
    filePath,
    title: filePath.split('/').pop() ?? filePath,
    openedAt,
  };
}

function createStorage(initial?: unknown, legacy?: unknown) {
  let stored = initial;
  let legacyStored = legacy;
  const storage: RecentDocumentStorage = {
    read: vi.fn(async () => structuredClone(stored)),
    write: vi.fn(async (value) => {
      stored = structuredClone(value);
    }),
    readLegacy: vi.fn(async () => structuredClone(legacyStored)),
    removeLegacy: vi.fn(async () => {
      legacyStored = undefined;
    }),
  };
  return { storage, getStored: () => stored, getLegacy: () => legacyStored };
}

describe('Recent Documents', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists deliberate activity in most-recent-first order', async () => {
    const backing = createStorage();
    const recentDocuments = await loadRecentDocuments(backing.storage, { debounceMs: 0 });

    recentDocuments.record(recentDocument('/docs/one.pdf', 10));
    recentDocuments.record(recentDocument('/docs/two.pdf', 20));
    recentDocuments.record(recentDocument('/docs/one.pdf', 30));
    await recentDocuments.flush();

    expect(recentDocuments.snapshot()).toEqual([
      recentDocument('/docs/one.pdf', 30),
      recentDocument('/docs/two.pdf', 20),
    ]);
    expect(backing.getStored()).toEqual({
      schemaVersion: 1,
      documents: [recentDocument('/docs/one.pdf', 30), recentDocument('/docs/two.pdf', 20)],
    } satisfies PersistedRecentDocuments);
  });

  it('bounds history and does not expose its authoritative snapshot to mutation', async () => {
    const backing = createStorage();
    const recentDocuments = await loadRecentDocuments(backing.storage, { limit: 2 });

    recentDocuments.record(recentDocument('/docs/one.pdf', 10));
    recentDocuments.record(recentDocument('/docs/two.pdf', 20));
    recentDocuments.record(recentDocument('/docs/three.pdf', 30));
    const snapshot = recentDocuments.snapshot() as Array<ReturnType<typeof recentDocument>>;
    snapshot[0].title = 'changed.pdf';
    snapshot.push(recentDocument('/docs/four.pdf', 40));

    expect(recentDocuments.snapshot()).toEqual([
      recentDocument('/docs/three.pdf', 30),
      recentDocument('/docs/two.pdf', 20),
    ]);
  });

  it('supports disabling retained history with a zero limit', async () => {
    const backing = createStorage();
    const recentDocuments = await loadRecentDocuments(backing.storage, { limit: 0 });

    recentDocuments.record(recentDocument('/docs/one.pdf', 10));

    expect(recentDocuments.snapshot()).toEqual([]);
  });

  it('isolates change observers from successful history updates', async () => {
    const backing = createStorage();
    const onObserverError = vi.fn();
    const recentDocuments = await loadRecentDocuments(backing.storage, {
      onChanged: () => {
        throw new Error('render failed');
      },
      onObserverError,
    });

    expect(() => recentDocuments.record(recentDocument('/docs/one.pdf', 10))).not.toThrow();
    expect(recentDocuments.snapshot()).toEqual([recentDocument('/docs/one.pdf', 10)]);
    expect(onObserverError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'render failed' }),
    );
  });

  it('retains the current snapshot as dirty after a failed write and permits retry', async () => {
    const backing = createStorage();
    vi.mocked(backing.storage.write).mockRejectedValueOnce(new Error('store unavailable'));
    const recentDocuments = await loadRecentDocuments(backing.storage, { retryMs: 60_000 });

    recentDocuments.record(recentDocument('/docs/one.pdf', 10));
    await expect(recentDocuments.flush()).rejects.toThrow('store unavailable');

    expect(recentDocuments.snapshot()).toEqual([recentDocument('/docs/one.pdf', 10)]);
    expect(recentDocuments.isDirty()).toBe(true);

    await recentDocuments.flush();
    expect(recentDocuments.isDirty()).toBe(false);
  });

  it('migrates, verifies, and only then removes legacy Recent Documents', async () => {
    const legacy = [recentDocument('/docs/one.pdf', 10)];
    const backing = createStorage(undefined, legacy);

    await loadRecentDocuments(backing.storage);

    expect(backing.getStored()).toEqual({ schemaVersion: 1, documents: legacy });
    expect(backing.getLegacy()).toBeUndefined();
    const writeOrder = vi.mocked(backing.storage.write).mock.invocationCallOrder[0];
    const verificationOrder = vi.mocked(backing.storage.read).mock.invocationCallOrder[1];
    const removalOrder = vi.mocked(backing.storage.removeLegacy).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(verificationOrder);
    expect(verificationOrder).toBeLessThan(removalOrder);
  });

  it('retains legacy history when dedicated persistence cannot be verified', async () => {
    const legacy = [recentDocument('/docs/one.pdf', 10)];
    const backing = createStorage(undefined, legacy);
    vi.mocked(backing.storage.write).mockResolvedValue(undefined);
    const onPersistenceError = vi.fn();

    const recentDocuments = await loadRecentDocuments(backing.storage, {
      retryMs: 60_000,
      onPersistenceError,
    });

    expect(recentDocuments.snapshot()).toEqual(legacy);
    expect(recentDocuments.isDirty()).toBe(true);
    expect(backing.getLegacy()).toEqual(legacy);
    expect(backing.storage.removeLegacy).not.toHaveBeenCalled();
    expect(onPersistenceError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('could not be verified') }),
    );
  });

  it('does not overwrite an unsupported dedicated schema with legacy history', async () => {
    const unsupported = {
      schemaVersion: 2,
      documents: [recentDocument('/docs/dedicated.pdf', 20)],
    };
    const legacy = [recentDocument('/docs/legacy.pdf', 10)];
    const backing = createStorage(unsupported, legacy);
    const recentDocuments = await loadRecentDocuments(backing.storage, { retryMs: 60_000 });

    expect(recentDocuments.snapshot()).toEqual(legacy);
    await expect(recentDocuments.flush()).rejects.toThrow(
      'Dedicated Recent Documents state is invalid',
    );
    expect(backing.storage.write).not.toHaveBeenCalled();
    expect(backing.getStored()).toEqual(unsupported);
    expect(backing.getLegacy()).toEqual(legacy);
  });
});
