import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PdfAnnotation } from '../lib/document-features';
import {
  type AnnotationStorage,
  loadAnnotations,
  type PersistedAnnotations,
} from '../reader/annotations';

const DOCUMENT_PATH = '/docs/report.pdf';

function annotation(overrides: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    id: 'highlight-1',
    kind: 'highlight',
    pageNumber: 4,
    rects: [{ x1: 10, y1: 20, x2: 30, y2: 40 }],
    text: 'Moonlight',
    note: '',
    color: 'yellow',
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

function createStorage(initial?: unknown, legacy?: unknown) {
  let stored = initial;
  let legacyStored = legacy;
  const storage: AnnotationStorage = {
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

describe('Annotation persistence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists a versioned Document-owned snapshot and restores it after reopen', async () => {
    const backing = createStorage();
    const firstRun = await loadAnnotations(backing.storage, { debounceMs: 0 });

    firstRun.replace(DOCUMENT_PATH, [annotation()]);
    await firstRun.flush();

    expect(backing.getStored()).toEqual({
      schemaVersion: 1,
      documents: { [DOCUMENT_PATH]: [annotation()] },
    });

    const secondRun = await loadAnnotations(backing.storage, { debounceMs: 0 });
    expect(secondRun.snapshot(DOCUMENT_PATH)).toEqual([annotation()]);
  });

  it('writes Annotation changes without receiving or rewriting unrelated state', async () => {
    const backing = createStorage();
    const annotations = await loadAnnotations(backing.storage, { debounceMs: 0 });

    annotations.replace(DOCUMENT_PATH, [annotation({ note: 'Remember this' })]);
    await annotations.flush();
    annotations.replace(DOCUMENT_PATH, [annotation({ color: 'blue', updatedAt: 20 })]);
    await annotations.flush();
    annotations.replace(DOCUMENT_PATH, []);
    await annotations.flush();

    const writes = vi.mocked(backing.storage.write).mock.calls.map(([value]) => value);
    expect(writes).toEqual([
      {
        schemaVersion: 1,
        documents: { [DOCUMENT_PATH]: [annotation({ note: 'Remember this' })] },
      },
      {
        schemaVersion: 1,
        documents: {
          [DOCUMENT_PATH]: [annotation({ color: 'blue', updatedAt: 20 })],
        },
      },
      { schemaVersion: 1, documents: {} },
    ] satisfies PersistedAnnotations[]);
  });

  it('falls back to legacy Annotations when migration cannot be persisted', async () => {
    const legacy = { [DOCUMENT_PATH]: [annotation()] };
    const backing = createStorage(undefined, legacy);
    vi.mocked(backing.storage.write).mockRejectedValueOnce(new Error('disk full'));
    const onPersistenceError = vi.fn();

    const annotations = await loadAnnotations(backing.storage, {
      debounceMs: 0,
      onPersistenceError,
    });

    expect(annotations.snapshot(DOCUMENT_PATH)).toEqual([annotation()]);
    expect(annotations.isDirty()).toBe(true);
    expect(backing.getLegacy()).toEqual(legacy);
    expect(backing.storage.removeLegacy).not.toHaveBeenCalled();
    expect(onPersistenceError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'disk full' }),
    );

    await annotations.flush();

    expect(annotations.isDirty()).toBe(false);
    expect(backing.getStored()).toEqual({ schemaVersion: 1, documents: legacy });
    expect(backing.getLegacy()).toBeUndefined();
  });

  it('treats a valid dedicated value as authoritative over stale legacy data', async () => {
    const dedicated = {
      schemaVersion: 1,
      documents: { [DOCUMENT_PATH]: [annotation({ note: 'Dedicated' })] },
    };
    const legacy = { [DOCUMENT_PATH]: [annotation({ note: 'Legacy' })] };
    const backing = createStorage(dedicated, legacy);

    const annotations = await loadAnnotations(backing.storage);

    expect(annotations.snapshot(DOCUMENT_PATH)).toEqual(dedicated.documents[DOCUMENT_PATH]);
    expect(backing.getLegacy()).toBeUndefined();
    expect(backing.storage.removeLegacy).toHaveBeenCalledOnce();
  });

  it('does not overwrite dedicated Annotations after a transient read failure', async () => {
    const dedicated = {
      schemaVersion: 1 as const,
      documents: { [DOCUMENT_PATH]: [annotation({ note: 'Dedicated' })] },
    };
    const legacy = { [DOCUMENT_PATH]: [annotation({ note: 'Legacy' })] };
    const backing = createStorage(dedicated, legacy);
    vi.mocked(backing.storage.read).mockRejectedValueOnce(new Error('temporary read failure'));

    const annotations = await loadAnnotations(backing.storage, { retryMs: 60_000 });

    expect(annotations.snapshot(DOCUMENT_PATH)).toEqual(legacy[DOCUMENT_PATH]);
    await expect(annotations.flush()).rejects.toThrow(
      'dedicated Annotation state could not be reconciled',
    );
    expect(backing.storage.write).not.toHaveBeenCalled();
    expect(backing.getStored()).toEqual(dedicated);
    expect(backing.getLegacy()).toEqual(legacy);
  });

  it('retries legacy cleanup across restart after dedicated state changes', async () => {
    const legacy = { [DOCUMENT_PATH]: [annotation()] };
    const backing = createStorage(undefined, legacy);
    vi.mocked(backing.storage.removeLegacy)
      .mockRejectedValueOnce(new Error('settings busy'))
      .mockRejectedValueOnce(new Error('settings still busy'));

    const annotations = await loadAnnotations(backing.storage, { debounceMs: 0 });

    expect(backing.getLegacy()).toEqual(legacy);
    annotations.replace(DOCUMENT_PATH, [annotation({ note: 'Updated' })]);
    await annotations.flush();
    expect(backing.getLegacy()).toEqual(legacy);

    const restarted = await loadAnnotations(backing.storage, { debounceMs: 0 });

    expect(backing.getLegacy()).toBeUndefined();
    expect(backing.storage.removeLegacy).toHaveBeenCalledTimes(3);
    expect(restarted.snapshot(DOCUMENT_PATH)).toEqual([annotation({ note: 'Updated' })]);
  });

  it('blocks partial writes when dedicated state cannot be read and no legacy remains', async () => {
    const dedicated = {
      schemaVersion: 1 as const,
      documents: { '/docs/other.pdf': [annotation()] },
    };
    const backing = createStorage(dedicated);
    vi.mocked(backing.storage.read).mockRejectedValueOnce(new Error('temporary read failure'));
    const annotations = await loadAnnotations(backing.storage, { retryMs: 60_000 });

    annotations.replace(DOCUMENT_PATH, [annotation({ note: 'New note' })]);

    await expect(annotations.flush()).rejects.toThrow(
      'dedicated Annotation state could not be reconciled',
    );
    expect(backing.storage.write).not.toHaveBeenCalled();
    expect(backing.getStored()).toEqual(dedicated);
    expect(annotations.snapshot(DOCUMENT_PATH)).toEqual([annotation({ note: 'New note' })]);
  });

  it('retries a failed dedicated read and restores persisted Annotations', async () => {
    vi.useFakeTimers();
    const dedicated = {
      schemaVersion: 1 as const,
      documents: { [DOCUMENT_PATH]: [annotation({ note: 'Persisted' })] },
    };
    const backing = createStorage(dedicated);
    vi.mocked(backing.storage.read).mockRejectedValueOnce(new Error('temporary read failure'));
    const annotations = await loadAnnotations(backing.storage, { retryMs: 50 });

    expect(annotations.snapshot(DOCUMENT_PATH)).toEqual([]);
    expect(annotations.isDirty()).toBe(true);

    await vi.advanceTimersByTimeAsync(50);

    expect(annotations.snapshot(DOCUMENT_PATH)).toEqual([annotation({ note: 'Persisted' })]);
    expect(annotations.isDirty()).toBe(false);
    expect(backing.storage.write).not.toHaveBeenCalled();
  });

  it('does not overwrite an unsupported dedicated schema', async () => {
    const unsupported = {
      schemaVersion: 2,
      documents: { '/docs/other.pdf': [annotation()] },
    };
    const backing = createStorage(unsupported);
    const onPersistenceError = vi.fn();
    const annotations = await loadAnnotations(backing.storage, {
      retryMs: 60_000,
      onPersistenceError,
    });

    expect(onPersistenceError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('unsupported or invalid schema'),
      }),
    );
    annotations.replace(DOCUMENT_PATH, [annotation({ note: 'New note' })]);

    await expect(annotations.flush()).rejects.toThrow('Dedicated Annotation state is invalid');
    expect(backing.storage.write).not.toHaveBeenCalled();
    expect(backing.getStored()).toEqual(unsupported);
    expect(annotations.snapshot(DOCUMENT_PATH)).toEqual([annotation({ note: 'New note' })]);
  });

  it('automatically retries a failed background write', async () => {
    vi.useFakeTimers();
    const backing = createStorage();
    const onPersistenceError = vi.fn();
    const annotations = await loadAnnotations(backing.storage, {
      debounceMs: 0,
      retryMs: 50,
      onPersistenceError,
    });
    vi.mocked(backing.storage.write).mockRejectedValueOnce(new Error('store unavailable'));

    annotations.replace(DOCUMENT_PATH, [annotation()]);
    await vi.advanceTimersByTimeAsync(0);

    expect(annotations.isDirty()).toBe(true);
    expect(onPersistenceError).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(50);

    expect(annotations.isDirty()).toBe(false);
    expect(backing.storage.write).toHaveBeenCalledTimes(2);
  });

  it('retains the current in-memory snapshot and dirty state after a write failure', async () => {
    const backing = createStorage();
    const onPersistenceError = vi.fn();
    const annotations = await loadAnnotations(backing.storage, {
      debounceMs: 60_000,
      onPersistenceError,
    });
    vi.mocked(backing.storage.write).mockRejectedValueOnce(new Error('store unavailable'));

    annotations.replace(DOCUMENT_PATH, [annotation({ note: 'Unsaved note' })]);
    await expect(annotations.flush()).rejects.toThrow('store unavailable');

    expect(annotations.snapshot(DOCUMENT_PATH)).toEqual([annotation({ note: 'Unsaved note' })]);
    expect(annotations.isDirty()).toBe(true);
    expect(onPersistenceError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'store unavailable' }),
    );

    await annotations.flush();
    expect(annotations.isDirty()).toBe(false);
  });

  it('does not let callers mutate the authoritative Annotation snapshot', async () => {
    const backing = createStorage({
      schemaVersion: 1,
      documents: { [DOCUMENT_PATH]: [annotation()] },
    });
    const annotations = await loadAnnotations(backing.storage);
    const snapshot = annotations.snapshot(DOCUMENT_PATH) as PdfAnnotation[];

    snapshot[0].note = 'changed';
    snapshot[0].rects[0].x1 = 999;
    snapshot.push(annotation({ id: 'highlight-2' }));

    expect(annotations.snapshot(DOCUMENT_PATH)).toEqual([annotation()]);
  });
});
