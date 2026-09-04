import { describe, expect, it, vi } from 'vitest';
import { createReadingSession } from '../reader/reading-session';

const INITIAL_SESSION = {
  schemaVersion: 2 as const,
  activeDocumentPath: '/docs/first.pdf',
  documents: [
    {
      filePath: '/docs/first.pdf',
      title: 'first.pdf',
      readingPosition: { page: 1, location: 0 },
    },
  ],
};

describe('Reading Session', () => {
  it('publishes immutable monotonic snapshots and isolates observer failures', () => {
    const observerError = vi.fn();
    const observed: number[] = [];
    const session = createReadingSession({
      initialSession: INITIAL_SESSION,
      write: vi.fn(),
      onObserverError: observerError,
    });
    session.observe(() => {
      throw new Error('broken observer');
    });
    session.observe((snapshot) => observed.push(snapshot.revision));

    const first = session.commit({ ...INITIAL_SESSION, activeDocumentPath: null }, 'immediate');
    const second = session.commit(INITIAL_SESSION, 'immediate');

    expect([first.revision, second.revision]).toEqual([1, 2]);
    expect(observed).toEqual([1, 2]);
    expect(observerError).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.documents)).toBe(true);
    expect(Object.isFrozen(second.documents[0].readingPosition)).toBe(true);
  });

  it('excludes transient reader state from Visual State snapshots', () => {
    const session = createReadingSession({
      initialSession: {
        ...INITIAL_SESSION,
        documents: [
          {
            ...INITIAL_SESSION.documents[0],
            visualState: {
              filterSettings: {
                brightness: 0,
                grayscale: 0,
                invert: 0,
                sepia: 0,
                hue: 0,
                extraBrightness: 0,
              },
              zoomIntent: { kind: 'fit-width' },
              rotation: 90,
              viewMode: 'continuous',
              presentation: true,
              searchQuery: 'needle',
              sidebar: 'outline',
              selection: { page: 1 },
              hoveredLink: 'https://example.com',
            } as never,
          },
        ],
      },
      write: vi.fn(),
    });

    expect(Object.keys(session.snapshot().documents[0].visualState ?? {}).sort()).toEqual([
      'filterSettings',
      'rotation',
      'viewMode',
      'zoomIntent',
    ]);
  });

  it('debounces settled-state persistence and flushes the newest snapshot', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const session = createReadingSession({
      initialSession: INITIAL_SESSION,
      write,
      debounceMs: 200,
    });

    session.commit(
      {
        ...INITIAL_SESSION,
        documents: [
          { ...INITIAL_SESSION.documents[0], readingPosition: { page: 2, location: 0.1 } },
        ],
      },
      'deferred',
    );
    session.commit(
      {
        ...INITIAL_SESSION,
        documents: [
          { ...INITIAL_SESSION.documents[0], readingPosition: { page: 3, location: 0.2 } },
        ],
      },
      'deferred',
    );

    await vi.advanceTimersByTimeAsync(199);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
    vi.useRealTimers();
  });

  it('writes document-set changes immediately', async () => {
    const write = vi.fn(async () => undefined);
    const session = createReadingSession({ initialSession: INITIAL_SESSION, write });

    session.commit({ ...INITIAL_SESSION, activeDocumentPath: null }, 'immediate');
    await session.flush();

    expect(write).toHaveBeenCalledOnce();
    expect(session.isDirty()).toBe(false);
  });

  it('retains dirty in-memory state after failure and retries on the next flush', async () => {
    const write = vi
      .fn<(snapshot: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    const session = createReadingSession({ initialSession: INITIAL_SESSION, write });
    session.commit({ ...INITIAL_SESSION, activeDocumentPath: null }, 'immediate');

    await expect(session.flush()).rejects.toThrow('disk full');
    expect(session.isDirty()).toBe(true);
    expect(session.snapshot().activeDocumentPath).toBeNull();

    await expect(session.flush()).resolves.toBeUndefined();
    expect(session.isDirty()).toBe(false);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('awaits a newer commit that arrives while a write is in flight', async () => {
    let releaseFirst: (() => void) | undefined;
    const writes: number[] = [];
    const write = vi.fn(async (snapshot: { revision: number }) => {
      writes.push(snapshot.revision);
      if (snapshot.revision === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
    });
    const session = createReadingSession({ initialSession: INITIAL_SESSION, write });
    session.commit({ ...INITIAL_SESSION, activeDocumentPath: null }, 'immediate');
    const flushing = session.flush();
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    session.commit(INITIAL_SESSION, 'deferred');
    releaseFirst?.();

    await flushing;
    expect(writes).toEqual([1, 2]);
    expect(session.isDirty()).toBe(false);
  });
});
