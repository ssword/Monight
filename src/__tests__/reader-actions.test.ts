import { describe, expect, it, vi } from 'vitest';
import {
  createReaderActions,
  type ReaderProjection,
  type ReadingSessionSnapshot,
} from '../reader/reader-actions';

const INITIAL_SESSION = {
  schemaVersion: 2 as const,
  activeDocumentPath: '/docs/first.pdf',
  documents: [
    {
      filePath: '/docs/first.pdf',
      title: 'first.pdf',
      readingPosition: { page: 2, location: 0.25 },
    },
    {
      filePath: '/docs/second.pdf',
      title: 'second.pdf',
      readingPosition: { page: 7, location: 0.5 },
    },
  ],
};

describe('Reader Actions', () => {
  it('activates an existing Document before committing and persisting the Reading Session', async () => {
    const events: string[] = [];
    const projection: ReaderProjection = {
      activateDocument: vi.fn(async (filePath) => {
        events.push(`render:${filePath}`);
      }),
      goToReadingPosition: vi.fn(),
    };
    const persisted: ReadingSessionSnapshot[] = [];
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection,
      persist: async (snapshot) => {
        events.push(`persist:${snapshot.activeDocumentPath}`);
        persisted.push(snapshot);
      },
    });

    reader.observe((snapshot) => {
      events.push(`observe:${snapshot.activeDocumentPath}`);
    });

    const outcome = await reader.dispatch({
      type: 'activateDocument',
      filePath: '/docs/second.pdf',
    });

    expect(outcome).toMatchObject({ status: 'committed', revision: 1 });
    expect(events).toEqual([
      'render:/docs/second.pdf',
      'observe:/docs/second.pdf',
      'persist:/docs/second.pdf',
    ]);
    expect(reader.snapshot()).toMatchObject({
      revision: 1,
      activeDocumentPath: '/docs/second.pdf',
    });
    expect(persisted).toHaveLength(1);
    expect(Object.isFrozen(persisted[0])).toBe(true);
    expect(Object.isFrozen(persisted[0].documents)).toBe(true);
  });

  it('captures the active Document when explicit page navigation is dispatched', async () => {
    let finishNavigation: (() => void) | undefined;
    const projection: ReaderProjection = {
      activateDocument: vi.fn(async () => undefined),
      goToReadingPosition: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishNavigation = resolve;
          }),
      ),
    };
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection,
      persist: vi.fn(async () => undefined),
    });

    const navigation = reader.dispatch({ type: 'goToPage', page: 9 });
    await reader.dispatch({ type: 'activateDocument', filePath: '/docs/second.pdf' });
    finishNavigation?.();
    const outcome = await navigation;

    expect(projection.goToReadingPosition).toHaveBeenCalledWith('/docs/first.pdf', {
      page: 9,
      location: 0,
    });
    expect(outcome.status).toBe('committed');
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/second.pdf',
      documents: [
        { filePath: '/docs/first.pdf', readingPosition: { page: 9, location: 0 } },
        { filePath: '/docs/second.pdf', readingPosition: { page: 7, location: 0.5 } },
      ],
    });
  });

  it('does not commit an explicit page when its rendering operation fails', async () => {
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(async () => {
          throw new Error('render failed');
        }),
      },
      persist: vi.fn(),
    });

    const outcome = await reader.dispatch({ type: 'goToPage', page: 11 });

    expect(outcome.status).toBe('failure');
    expect(reader.snapshot().revision).toBe(0);
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 2, location: 0.25 });
  });

  it('does not commit page navigation cancelled while projection is in flight', async () => {
    let finishNavigation: (() => void) | undefined;
    let cancelled = false;
    const persist = vi.fn();
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishNavigation = resolve;
            }),
        ),
      },
      persist,
    });

    const navigation = reader.dispatch(
      { type: 'goToPage', page: 11 },
      { isCancelled: () => cancelled },
    );
    await vi.waitFor(() => expect(finishNavigation).toBeTypeOf('function'));
    cancelled = true;
    finishNavigation?.();

    await expect(navigation).resolves.toMatchObject({ status: 'no-op', revision: 0 });
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 2, location: 0.25 });
    expect(persist).not.toHaveBeenCalled();
  });

  it('treats a cancelled throwing page projection as a no-op', async () => {
    let cancelled = false;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(async () => {
          cancelled = true;
          throw new Error('render aborted');
        }),
      },
      persist: vi.fn(),
    });

    const outcome = await reader.dispatch(
      { type: 'goToPage', page: 11 },
      { isCancelled: () => cancelled },
    );

    expect(outcome).toMatchObject({ status: 'no-op', revision: 0 });
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 2, location: 0.25 });
  });

  it('commits settled scroll positions and isolates failing observers', async () => {
    const observerError = new Error('broken UI observer');
    const observedRevisions: number[] = [];
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
      },
      persist: vi.fn(),
      onObserverError: vi.fn(),
    });
    reader.observe(() => {
      throw observerError;
    });
    reader.observe((snapshot) => observedRevisions.push(snapshot.revision));

    const first = await reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/first.pdf',
      readingPosition: { page: 3, location: 0.375 },
    });
    const second = await reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/first.pdf',
      readingPosition: { page: 4, location: 0.125 },
    });

    expect(first).toMatchObject({ status: 'committed', revision: 1 });
    expect(second).toMatchObject({ status: 'committed', revision: 2 });
    expect(observedRevisions).toEqual([1, 2]);
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 4, location: 0.125 });
  });

  it('registers new Documents through the dispatcher without duplicating existing paths', async () => {
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
      },
      persist: vi.fn(),
    });

    await reader.dispatch({
      type: 'registerDocument',
      document: {
        filePath: '/docs/third.pdf',
        title: 'third.pdf',
        readingPosition: { page: 1, location: 0 },
      },
    });
    const duplicate = await reader.dispatch({
      type: 'registerDocument',
      document: {
        filePath: '/docs/first.pdf',
        title: 'renamed.pdf',
        readingPosition: { page: 1, location: 0 },
      },
    });

    expect(reader.snapshot().documents.map(({ filePath }) => filePath)).toEqual([
      '/docs/first.pdf',
      '/docs/second.pdf',
      '/docs/third.pdf',
    ]);
    expect(duplicate.status).toBe('no-op');
  });

  it('keeps an immediate semantic commit authoritative when persistence fails', async () => {
    const persist = vi.fn(async () => {
      throw new Error('disk full');
    });
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
      },
      persist,
    });

    const outcome = await reader.dispatch({
      type: 'registerDocument',
      document: {
        filePath: '/docs/third.pdf',
        title: 'third.pdf',
        readingPosition: { page: 1, location: 0 },
      },
    });

    expect(outcome).toMatchObject({ status: 'committed', revision: 1 });
    expect(reader.snapshot().documents).toHaveLength(3);
    expect(reader.hasDirtySession()).toBe(true);
    await expect(reader.flush()).rejects.toThrow('disk full');
  });

  it('reports the revision committed by each concurrent action', async () => {
    let releaseFirstWrite: (() => void) | undefined;
    let writes = 0;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
      },
      persist: vi.fn(async () => {
        writes += 1;
        if (writes === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
          });
        }
      }),
    });

    const first = reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/first.pdf',
      readingPosition: { page: 3, location: 0.1 },
    });
    await vi.waitFor(() => expect(releaseFirstWrite).toBeTypeOf('function'));
    const second = reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/second.pdf',
      readingPosition: { page: 8, location: 0.2 },
    });
    releaseFirstWrite?.();

    await expect(first).resolves.toMatchObject({ revision: 1 });
    await expect(second).resolves.toMatchObject({ revision: 2 });
  });

  it('supersedes queued absolute page selections with the newest value', async () => {
    let releaseFirst: (() => void) | undefined;
    const pages: number[] = [];
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(async (_filePath, position) => {
          pages.push(position.page);
          if (position.page === 3) {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
          }
        }),
      },
      persist: vi.fn(),
    });

    const first = reader.dispatch({ type: 'goToPage', page: 3 });
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    const obsolete = reader.dispatch({ type: 'goToPage', page: 4 });
    const newest = reader.dispatch({ type: 'goToPage', page: 5 });
    releaseFirst?.();

    await expect(first).resolves.toMatchObject({ status: 'committed' });
    await expect(obsolete).resolves.toMatchObject({ status: 'superseded' });
    await expect(newest).resolves.toMatchObject({ status: 'committed' });
    expect(pages).toEqual([3, 5]);
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 5, location: 0 });
  });

  it('lets different Documents progress independently', async () => {
    let releaseFirst: (() => void) | undefined;
    const completed: string[] = [];
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(async (filePath) => {
          if (filePath === '/docs/first.pdf') {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
          }
          completed.push(filePath);
        }),
      },
      persist: vi.fn(),
    });

    const slow = reader.dispatch({ type: 'goToPage', filePath: '/docs/first.pdf', page: 3 });
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    const independent = reader.dispatch({
      type: 'goToPage',
      filePath: '/docs/second.pdf',
      page: 8,
    });

    await expect(independent).resolves.toMatchObject({ status: 'committed' });
    expect(completed).toEqual(['/docs/second.pdf']);
    releaseFirst?.();
    await slow;
  });

  it('preserves dispatch order for successive relative page actions', async () => {
    let releaseFirst: (() => void) | undefined;
    const pages: number[] = [];
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        getPageCount: vi.fn(() => 20),
        goToReadingPosition: vi.fn(async (_filePath, position) => {
          pages.push(position.page);
          if (position.page === 3) {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
          }
        }),
      },
      persist: vi.fn(),
    });

    const first = reader.dispatch({ type: 'goToNextPage' });
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    const second = reader.dispatch({ type: 'goToNextPage' });
    releaseFirst?.();

    await expect(first).resolves.toMatchObject({ status: 'committed' });
    await expect(second).resolves.toMatchObject({ status: 'committed' });
    expect(pages).toEqual([3, 4]);
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 4, location: 0 });
  });

  it('treats a generation-cancelled throwing relative projection as a no-op', async () => {
    let removeDocument: (() => Promise<void>) | undefined;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        getPageCount: vi.fn(() => 20),
        goToReadingPosition: vi.fn(async () => {
          await removeDocument?.();
          throw new Error('render aborted');
        }),
      },
      persist: vi.fn(),
    });
    removeDocument = async () => {
      await reader.dispatch({ type: 'removeDocument', filePath: '/docs/first.pdf' });
    };

    const outcome = await reader.dispatch({ type: 'goToNextPage' });

    expect(outcome.status).toBe('no-op');
    expect(reader.snapshot().documents).toHaveLength(1);
  });

  it('never navigates below page one when the projection has no page count yet', async () => {
    const goToReadingPosition = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        getPageCount: vi.fn(() => 0),
        goToReadingPosition,
      },
      persist: vi.fn(),
    });

    const outcome = await reader.dispatch({ type: 'goToPreviousPage' });

    expect(outcome).toMatchObject({ status: 'committed' });
    expect(goToReadingPosition).toHaveBeenCalledWith(
      '/docs/first.pdf',
      { page: 1, location: 0 },
      expect.any(Object),
    );
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 1, location: 0 });
  });

  it('cancels late page commits when a Document is removed', async () => {
    let finishNavigation: (() => void) | undefined;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishNavigation = resolve;
            }),
        ),
      },
      persist: vi.fn(),
    });

    const navigation = reader.dispatch({ type: 'goToPage', page: 9 });
    await vi.waitFor(() => expect(finishNavigation).toBeTypeOf('function'));
    await reader.dispatch({ type: 'removeDocument', filePath: '/docs/first.pdf' });
    finishNavigation?.();

    await expect(navigation).resolves.toMatchObject({ status: 'no-op' });
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/second.pdf',
      documents: [{ filePath: '/docs/second.pdf' }],
    });
  });

  it('flushes pending Reading Session persistence explicitly', async () => {
    const persist = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: { activateDocument: vi.fn(), goToReadingPosition: vi.fn() },
      persist,
    });

    await reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/first.pdf',
      readingPosition: { page: 3, location: 0.1 },
    });
    await reader.flush();

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }));
  });

  it('commits settled Visual State through the semantic dispatcher', async () => {
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: { activateDocument: vi.fn(), goToReadingPosition: vi.fn() },
      persist: vi.fn(),
    });

    const outcome = await reader.dispatch({
      type: 'settleVisualState',
      filePath: '/docs/first.pdf',
      visualState: {
        filterSettings: {
          brightness: 90,
          grayscale: 10,
          invert: 0,
          sepia: 5,
          hue: 0,
          extraBrightness: 100,
        },
        zoomIntent: { kind: 'manual', scale: 1.5 },
        rotation: 90,
        viewMode: 'continuous',
      },
    });

    expect(outcome).toMatchObject({ status: 'committed', revision: 1 });
    expect(reader.snapshot().documents[0].visualState).toMatchObject({
      zoomIntent: { kind: 'manual', scale: 1.5 },
      rotation: 90,
      viewMode: 'continuous',
    });
  });
});
