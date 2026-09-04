import { describe, expect, it, vi } from 'vitest';
import { createDocumentIntake } from '../reader/document-intake';
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
  it('initializes missing Visual State from configured reader defaults', () => {
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      defaultVisualState: {
        filterSettings: {
          brightness: 8,
          grayscale: 100,
          invert: 92,
          sepia: 100,
          hue: 295,
          extraBrightness: -6,
        },
        zoomIntent: { kind: 'manual', scale: 1 },
        rotation: 0,
        viewMode: 'continuous',
      },
      projection: { activateDocument: vi.fn(), goToReadingPosition: vi.fn() },
      persist: vi.fn(),
    });

    expect(reader.snapshot().documents).toEqual([
      expect.objectContaining({
        filePath: '/docs/first.pdf',
        visualState: expect.objectContaining({ viewMode: 'continuous' }),
      }),
      expect.objectContaining({
        filePath: '/docs/second.pdf',
        visualState: expect.objectContaining({ viewMode: 'continuous' }),
      }),
    ]);
  });

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

  it('commits an explicit Reading Position supplied with Document activation', async () => {
    const projection: ReaderProjection = {
      activateDocument: vi.fn(async () => undefined),
      goToReadingPosition: vi.fn(),
    };
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection,
      persist: vi.fn(async () => undefined),
    });

    const outcome = await reader.dispatch({
      type: 'activateDocument',
      filePath: '/docs/second.pdf',
      readingPosition: { page: 7, location: 0 },
    });

    expect(outcome.status).toBe('committed');
    expect(projection.activateDocument).toHaveBeenCalledWith(
      '/docs/second.pdf',
      { page: 7, location: 0 },
      expect.anything(),
    );
    expect(
      reader.snapshot().documents.find(({ filePath }) => filePath === '/docs/second.pdf')
        ?.readingPosition,
    ).toEqual({ page: 7, location: 0 });
  });

  it('canonicalizes Document identities and removes alias duplicates', async () => {
    const reader = createReaderActions({
      initialSession: {
        schemaVersion: 2,
        activeDocumentPath: '/alias/report.pdf',
        documents: [
          {
            ...INITIAL_SESSION.documents[0],
            filePath: '/alias/report.pdf',
            title: 'report.pdf',
          },
          {
            ...INITIAL_SESSION.documents[1],
            filePath: '/other-alias/report.pdf',
            title: 'report.pdf',
          },
          {
            ...INITIAL_SESSION.documents[1],
            filePath: '/docs/extra.pdf',
            title: 'extra.pdf',
          },
        ],
      },
      projection: { activateDocument: vi.fn(), goToReadingPosition: vi.fn() },
      persist: vi.fn(async () => undefined),
    });

    const outcome = await reader.canonicalizeDocumentPaths([
      {
        requestedPath: '/alias/report.pdf',
        canonicalPath: '/docs/report.pdf',
        runtimeStateSource: 'requested',
      },
      {
        requestedPath: '/other-alias/report.pdf',
        canonicalPath: '/docs/report.pdf',
        runtimeStateSource: 'canonical',
      },
    ]);

    expect(outcome.status).toBe('committed');
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/report.pdf',
      documents: [
        { filePath: '/docs/report.pdf', title: 'report.pdf' },
        { filePath: '/docs/extra.pdf', title: 'extra.pdf' },
      ],
    });
  });

  it('prefers the registered canonical runtime state when aliases collapse', async () => {
    const reader = createReaderActions({
      initialSession: {
        schemaVersion: 2,
        activeDocumentPath: '/alias/saved-active.pdf',
        documents: [
          {
            ...INITIAL_SESSION.documents[0],
            filePath: '/alias/other.pdf',
            readingPosition: { page: 2, location: 0.2 },
          },
          {
            ...INITIAL_SESSION.documents[1],
            filePath: '/alias/saved-active.pdf',
            readingPosition: { page: 8, location: 0.8 },
          },
          {
            ...INITIAL_SESSION.documents[1],
            filePath: '/docs/report.pdf',
            readingPosition: { page: 2, location: 0.2 },
          },
        ],
      },
      projection: { activateDocument: vi.fn(), goToReadingPosition: vi.fn() },
      persist: vi.fn(async () => undefined),
    });

    await reader.canonicalizeDocumentPaths([
      {
        requestedPath: '/alias/saved-active.pdf',
        canonicalPath: '/docs/report.pdf',
        runtimeStateSource: 'requested',
      },
      {
        requestedPath: '/alias/other.pdf',
        canonicalPath: '/docs/report.pdf',
        runtimeStateSource: 'canonical',
      },
    ]);

    expect(reader.snapshot().documents).toEqual([
      expect.objectContaining({
        filePath: '/docs/report.pdf',
        readingPosition: { page: 8, location: 0.8 },
      }),
    ]);
  });

  it('uses a restored runtime Document supplied during canonical reconciliation', async () => {
    const restoredRuntimeDocument = {
      ...INITIAL_SESSION.documents[0],
      filePath: '/docs/report.pdf',
      readingPosition: { page: 9, location: 0 } as const,
    };
    const reader = createReaderActions({
      initialSession: {
        schemaVersion: 2,
        activeDocumentPath: '/alias/report.pdf',
        documents: [
          {
            ...INITIAL_SESSION.documents[0],
            filePath: '/alias/report.pdf',
            readingPosition: { page: 3, location: 0.3 },
          },
          {
            ...INITIAL_SESSION.documents[1],
            filePath: '/docs/report.pdf',
            readingPosition: { page: 2, location: 0.2 },
          },
        ],
      },
      projection: { activateDocument: vi.fn(), goToReadingPosition: vi.fn() },
      persist: vi.fn(async () => undefined),
    });

    await reader.canonicalizeDocumentPaths([
      {
        requestedPath: '/alias/report.pdf',
        canonicalPath: '/docs/report.pdf',
        runtimeStateSource: 'canonical',
        document: restoredRuntimeDocument,
      },
    ]);

    expect(reader.snapshot().documents).toEqual([restoredRuntimeDocument]);
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

    expect(projection.goToReadingPosition).toHaveBeenCalledWith(
      '/docs/first.pdf',
      {
        page: 9,
        location: 0,
      },
      expect.objectContaining({ isCancelled: expect.any(Function) }),
    );
    expect(outcome.status).toBe('committed');
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/second.pdf',
      documents: [
        { filePath: '/docs/first.pdf', readingPosition: { page: 9, location: 0 } },
        { filePath: '/docs/second.pdf', readingPosition: { page: 7, location: 0.5 } },
      ],
    });
  });

  it('resolves implicit navigation after an earlier activation commits', async () => {
    let releaseActivation: (() => void) | undefined;
    const pages: Array<{ filePath: string; page: number }> = [];
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseActivation = resolve;
            }),
        ),
        getPageCount: vi.fn(() => 20),
        goToReadingPosition: vi.fn(async (filePath, position) => {
          pages.push({ filePath, page: position.page });
        }),
      },
      persist: vi.fn(),
    });

    const activation = reader.dispatch({
      type: 'activateDocument',
      filePath: '/docs/second.pdf',
    });
    await vi.waitFor(() => expect(releaseActivation).toBeTypeOf('function'));
    const navigation = reader.dispatch({ type: 'goToNextPage' });

    await Promise.resolve();
    expect(pages).toEqual([]);
    releaseActivation?.();
    await expect(activation).resolves.toMatchObject({ status: 'committed', revision: 1 });
    await expect(navigation).resolves.toMatchObject({ status: 'committed', revision: 2 });
    expect(pages).toEqual([{ filePath: '/docs/second.pdf', page: 8 }]);
  });

  it('coalesces absolute actions waiting behind a global mutation', async () => {
    let releaseActivation: (() => void) | undefined;
    const goToReadingPosition = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseActivation = resolve;
            }),
        ),
        goToReadingPosition,
      },
      persist: vi.fn(),
    });

    const activation = reader.dispatch({
      type: 'activateDocument',
      filePath: '/docs/second.pdf',
    });
    await vi.waitFor(() => expect(releaseActivation).toBeTypeOf('function'));
    const first = reader.dispatch({ type: 'goToPage', page: 8 });
    const obsolete = reader.dispatch({ type: 'goToPage', page: 9 });
    const newest = reader.dispatch({ type: 'goToPage', page: 10 });
    releaseActivation?.();

    await expect(activation).resolves.toMatchObject({ status: 'committed', revision: 1 });
    await expect(first).resolves.toMatchObject({ status: 'superseded' });
    await expect(obsolete).resolves.toMatchObject({ status: 'superseded' });
    await expect(newest).resolves.toMatchObject({ status: 'committed', revision: 2 });
    expect(goToReadingPosition).toHaveBeenCalledOnce();
    expect(goToReadingPosition).toHaveBeenCalledWith(
      '/docs/second.pdf',
      {
        page: 10,
        location: 0,
      },
      expect.objectContaining({ isCancelled: expect.any(Function) }),
    );
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
        closeDocument: vi.fn(async () => undefined),
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

  it('routes an explicit action after a preceding Document registration commits', async () => {
    const goToReadingPosition = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition,
      },
      persist: vi.fn(),
    });

    const registration = reader.dispatch({
      type: 'registerDocument',
      document: {
        filePath: '/docs/third.pdf',
        title: 'third.pdf',
        readingPosition: { page: 1, location: 0 },
      },
    });
    const navigation = reader.dispatch({
      type: 'goToPage',
      filePath: '/docs/third.pdf',
      page: 4,
    });

    await expect(registration).resolves.toMatchObject({ status: 'committed', revision: 1 });
    await expect(navigation).resolves.toMatchObject({ status: 'committed', revision: 2 });
    expect(goToReadingPosition).toHaveBeenCalledWith(
      '/docs/third.pdf',
      {
        page: 4,
        location: 0,
      },
      expect.objectContaining({ isCancelled: expect.any(Function) }),
    );
  });

  it('preserves global dispatch order for Document-set mutations', async () => {
    let releaseClose: (() => void) | undefined;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        closeDocument: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseClose = resolve;
            }),
        ),
      },
      persist: vi.fn(),
    });

    const removal = reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });
    await vi.waitFor(() => expect(releaseClose).toBeTypeOf('function'));
    const registration = reader.dispatch({
      type: 'registerDocument',
      document: {
        filePath: '/docs/third.pdf',
        title: 'third.pdf',
        readingPosition: { page: 1, location: 0 },
      },
    });

    expect(reader.snapshot().revision).toBe(0);
    releaseClose?.();
    await expect(removal).resolves.toMatchObject({ status: 'committed', revision: 1 });
    await expect(registration).resolves.toMatchObject({ status: 'committed', revision: 2 });
    expect(reader.snapshot().documents.map(({ filePath }) => filePath)).toEqual([
      '/docs/second.pdf',
      '/docs/third.pdf',
    ]);
  });

  it('closes the active Document after presentation exits and selects the right neighbor', async () => {
    const events: string[] = [];
    const exitPresentation = vi.fn(async () => {
      events.push('presentation:exit');
    });
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        exitPresentation,
        closeDocument: vi.fn(async (filePath, nextActiveDocumentPath) => {
          events.push(`close:${filePath}:activate:${nextActiveDocumentPath}`);
        }),
      },
      persist: vi.fn(async () => undefined),
    });

    const outcome = await reader.dispatch({
      type: 'closeDocument',
      filePath: '/docs/first.pdf',
    });

    expect(outcome).toMatchObject({ status: 'committed', revision: 1 });
    expect(exitPresentation).toHaveBeenCalledWith({ restoreVisualState: false });
    expect(events).toEqual([
      'presentation:exit',
      'close:/docs/first.pdf:activate:/docs/second.pdf',
    ]);
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/second.pdf',
      documents: [{ filePath: '/docs/second.pdf' }],
    });
  });

  it('selects the left neighbor when closing the rightmost active Document', async () => {
    const closeDocument = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: {
        ...INITIAL_SESSION,
        activeDocumentPath: '/docs/second.pdf',
      },
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        closeDocument,
      },
      persist: vi.fn(async () => undefined),
    });

    await reader.dispatch({ type: 'closeDocument', filePath: '/docs/second.pdf' });

    expect(closeDocument).toHaveBeenCalledWith('/docs/second.pdf', '/docs/first.pdf');
    expect(reader.snapshot().activeDocumentPath).toBe('/docs/first.pdf');
  });

  it('does not exit presentation when closing an inactive Document', async () => {
    const exitPresentation = vi.fn(async () => undefined);
    const closeDocument = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        exitPresentation,
        closeDocument,
      },
      persist: vi.fn(async () => undefined),
    });

    await reader.dispatch({ type: 'closeDocument', filePath: '/docs/second.pdf' });

    expect(exitPresentation).not.toHaveBeenCalled();
    expect(closeDocument).toHaveBeenCalledWith('/docs/second.pdf', '/docs/first.pdf');
    expect(reader.snapshot().activeDocumentPath).toBe('/docs/first.pdf');
  });

  it('does not commit semantic close without a runtime-close projection', async () => {
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
      },
      persist: vi.fn(async () => undefined),
    });

    await expect(
      reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' }),
    ).resolves.toMatchObject({ status: 'failure', revision: 0 });
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/first.pdf',
      documents: [{ filePath: '/docs/first.pdf' }, { filePath: '/docs/second.pdf' }],
    });
  });

  it('reopens successfully closed Documents in last-in-first-out order', async () => {
    const reopenDocument = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        closeDocument: vi.fn(async () => undefined),
      },
      reopenDocument,
      persist: vi.fn(async () => undefined),
    });

    await reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });
    await reader.dispatch({ type: 'closeDocument', filePath: '/docs/second.pdf' });
    const firstReopen = await reader.dispatch({ type: 'reopenLastClosedDocument' });
    const secondReopen = await reader.dispatch({ type: 'reopenLastClosedDocument' });

    expect(firstReopen.status).toBe('committed');
    expect(secondReopen.status).toBe('committed');
    expect(reopenDocument.mock.calls).toEqual([['/docs/second.pdf'], ['/docs/first.pdf']]);
  });

  it('orders later Document-set actions behind a reopen intake', async () => {
    let finishReopen: (() => void) | undefined;
    const closeDocument = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        closeDocument,
      },
      reopenDocument: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishReopen = resolve;
          }),
      ),
      persist: vi.fn(async () => undefined),
    });
    await reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });
    closeDocument.mockClear();

    const reopen = reader.dispatch({ type: 'reopenLastClosedDocument' });
    await vi.waitFor(() => expect(finishReopen).toBeTypeOf('function'));
    const laterClose = reader.dispatch({
      type: 'closeDocument',
      filePath: '/docs/second.pdf',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(closeDocument).not.toHaveBeenCalled();
    finishReopen?.();
    await expect(reopen).resolves.toMatchObject({ status: 'committed' });
    await expect(laterClose).resolves.toMatchObject({ status: 'committed' });
    expect(closeDocument).toHaveBeenCalledWith('/docs/second.pdf', null);
  });

  it('retains the most recently closed Document when reopen fails', async () => {
    const reopenDocument = vi
      .fn<(filePath: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Document Intake failed'))
      .mockResolvedValueOnce(undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        closeDocument: vi.fn(async () => undefined),
      },
      reopenDocument,
      persist: vi.fn(async () => undefined),
    });

    await reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });

    await expect(reader.dispatch({ type: 'reopenLastClosedDocument' })).resolves.toMatchObject({
      status: 'failure',
    });
    await expect(reader.dispatch({ type: 'reopenLastClosedDocument' })).resolves.toMatchObject({
      status: 'committed',
    });
    expect(reopenDocument).toHaveBeenNthCalledWith(1, '/docs/first.pdf');
    expect(reopenDocument).toHaveBeenNthCalledWith(2, '/docs/first.pdf');
  });

  it('starts a new app run with no Recently Closed Documents', async () => {
    const firstRun = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        closeDocument: vi.fn(async () => undefined),
      },
      reopenDocument: vi.fn(async () => undefined),
      persist: vi.fn(async () => undefined),
    });
    await firstRun.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });

    const reopenDocument = vi.fn(async () => undefined);
    const secondRun = createReaderActions({
      initialSession: firstRun.snapshot(),
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
      },
      reopenDocument,
      persist: vi.fn(async () => undefined),
    });

    await expect(secondRun.dispatch({ type: 'reopenLastClosedDocument' })).resolves.toMatchObject({
      status: 'no-op',
    });
    expect(reopenDocument).not.toHaveBeenCalled();
    expect(Object.keys(firstRun.snapshot())).not.toContain('recentlyClosedDocumentPaths');
  });

  it('reopens a duplicate path through normal Document Intake semantics', async () => {
    const read = vi.fn(async () => new Uint8Array([1]));
    const open = vi.fn(async () => undefined);
    const onSucceeded = vi.fn();
    let reader!: ReturnType<typeof createReaderActions>;
    const intake = createDocumentIntake({
      source: {
        describe: async (requestedPath) => ({
          canonicalPath: requestedPath,
          title: requestedPath.split('/').pop() ?? requestedPath,
        }),
        read,
      },
      runtime: {
        isOpen: (filePath) =>
          reader.snapshot().documents.some((document) => document.filePath === filePath),
        activate: async (filePath) => {
          const outcome = await reader.dispatch({ type: 'activateDocument', filePath });
          if (outcome.status === 'failure') throw outcome.error;
        },
        open,
        goToPage: vi.fn(async () => undefined),
      },
      onSucceeded,
    });
    reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(async () => undefined),
        goToReadingPosition: vi.fn(),
        closeDocument: vi.fn(async () => undefined),
      },
      reopenDocument: async (filePath) => {
        const result = await intake.open([filePath]);
        const failure = result.outcomes.find((outcome) => outcome.status === 'failed');
        if (failure?.status === 'failed') throw failure.error;
      },
      persist: vi.fn(async () => undefined),
    });

    await reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });
    await reader.dispatch({
      type: 'registerDocument',
      document: INITIAL_SESSION.documents[0],
    });

    await expect(reader.dispatch({ type: 'reopenLastClosedDocument' })).resolves.toMatchObject({
      status: 'committed',
    });
    expect(reader.snapshot().activeDocumentPath).toBe('/docs/first.pdf');
    expect(read).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(onSucceeded).toHaveBeenCalledWith({
      status: 'activated',
      requestedPath: '/docs/first.pdf',
      filePath: '/docs/first.pdf',
    });
  });

  it('orders later Document actions behind earlier global mutations', async () => {
    let releaseActivation: (() => void) | undefined;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseActivation = resolve;
            }),
        ),
        goToReadingPosition: vi.fn(),
      },
      persist: vi.fn(),
    });

    const activation = reader.dispatch({
      type: 'activateDocument',
      filePath: '/docs/second.pdf',
    });
    await vi.waitFor(() => expect(releaseActivation).toBeTypeOf('function'));
    const registration = reader.dispatch({
      type: 'registerDocument',
      document: {
        filePath: '/docs/third.pdf',
        title: 'third.pdf',
        readingPosition: { page: 1, location: 0 },
      },
    });
    const settled = reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/third.pdf',
      readingPosition: { page: 4, location: 0.5 },
    });
    releaseActivation?.();

    await expect(activation).resolves.toMatchObject({ status: 'committed', revision: 1 });
    await expect(registration).resolves.toMatchObject({ status: 'committed', revision: 2 });
    await expect(settled).resolves.toMatchObject({ status: 'committed', revision: 3 });
    expect(reader.snapshot().documents[2].readingPosition).toEqual({ page: 4, location: 0.5 });
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

  it('orders and coalesces settled Reading Positions within a Document lane', async () => {
    let releaseNavigation: (() => void) | undefined;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseNavigation = resolve;
            }),
        ),
      },
      persist: vi.fn(),
    });

    const navigation = reader.dispatch({ type: 'goToPage', page: 3 });
    await vi.waitFor(() => expect(releaseNavigation).toBeTypeOf('function'));
    const obsolete = reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/first.pdf',
      readingPosition: { page: 4, location: 0.25 },
    });
    const newest = reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/first.pdf',
      readingPosition: { page: 5, location: 0.75 },
    });
    releaseNavigation?.();

    await expect(navigation).resolves.toMatchObject({ status: 'committed', revision: 1 });
    await expect(obsolete).resolves.toMatchObject({ status: 'superseded' });
    await expect(newest).resolves.toMatchObject({ status: 'committed', revision: 2 });
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 5, location: 0.75 });
  });

  it('coalesces absolute Reading Position variants by semantic state', async () => {
    let releaseNavigation: (() => void) | undefined;
    const pages: number[] = [];
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(async (_filePath, position) => {
          pages.push(position.page);
          if (position.page === 3) {
            await new Promise<void>((resolve) => {
              releaseNavigation = resolve;
            });
          }
        }),
      },
      persist: vi.fn(),
    });

    const navigation = reader.dispatch({ type: 'goToPage', page: 3 });
    await vi.waitFor(() => expect(releaseNavigation).toBeTypeOf('function'));
    const obsolete = reader.dispatch({ type: 'goToPage', page: 4 });
    const newest = reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/first.pdf',
      readingPosition: { page: 5, location: 0.5 },
    });
    releaseNavigation?.();

    await expect(navigation).resolves.toMatchObject({ status: 'committed', revision: 1 });
    await expect(obsolete).resolves.toMatchObject({ status: 'superseded' });
    await expect(newest).resolves.toMatchObject({ status: 'committed', revision: 2 });
    expect(pages).toEqual([3]);
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 5, location: 0.5 });
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

  it('continues a Document lane after a failed projection', async () => {
    const goToReadingPosition = vi
      .fn<ReaderProjection['goToReadingPosition']>()
      .mockRejectedValueOnce(new Error('render failed'))
      .mockResolvedValueOnce(undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        getPageCount: vi.fn(() => 20),
        goToReadingPosition,
      },
      persist: vi.fn(),
    });

    const failed = reader.dispatch({ type: 'goToNextPage' });
    const recovered = reader.dispatch({ type: 'goToNextPage' });

    await expect(failed).resolves.toMatchObject({ status: 'failure', revision: 0 });
    await expect(recovered).resolves.toMatchObject({ status: 'committed', revision: 1 });
    expect(goToReadingPosition).toHaveBeenCalledTimes(2);
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 3, location: 0 });
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

  it('does not project relative navigation after removal during page-count lookup', async () => {
    let releasePageCount: (() => void) | undefined;
    const goToReadingPosition = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        getPageCount: vi.fn(
          () =>
            new Promise<number>((resolve) => {
              releasePageCount = () => resolve(20);
            }),
        ),
        goToReadingPosition,
      },
      persist: vi.fn(),
    });

    const navigation = reader.dispatch({ type: 'goToNextPage' });
    await vi.waitFor(() => expect(releasePageCount).toBeTypeOf('function'));
    await reader.dispatch({ type: 'removeDocument', filePath: '/docs/first.pdf' });
    await reader.dispatch({
      type: 'registerDocument',
      document: INITIAL_SESSION.documents[0],
    });
    releasePageCount?.();

    await expect(navigation).resolves.toMatchObject({ status: 'no-op', revision: 2 });
    expect(goToReadingPosition).not.toHaveBeenCalled();
    expect(reader.snapshot().documents[1].readingPosition).toEqual({ page: 2, location: 0.25 });
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

  it('ignores late page completions after a Document is closed', async () => {
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
        closeDocument: vi.fn(async () => undefined),
      },
      persist: vi.fn(),
    });

    const navigation = reader.dispatch({ type: 'goToPage', page: 9 });
    await vi.waitFor(() => expect(finishNavigation).toBeTypeOf('function'));
    await reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });
    finishNavigation?.();

    await expect(navigation).resolves.toMatchObject({ status: 'no-op' });
    expect(reader.snapshot()).toMatchObject({
      activeDocumentPath: '/docs/second.pdf',
      documents: [{ filePath: '/docs/second.pdf' }],
    });
  });

  it('cancels in-flight Document work as soon as semantic close is dispatched', async () => {
    let finishNavigation: (() => void) | undefined;
    let navigationOptions: { isCancelled?: () => boolean } | undefined;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn((_filePath, _position, options) => {
          navigationOptions = options;
          return new Promise<void>((resolve) => {
            finishNavigation = resolve;
          });
        }),
        closeDocument: vi.fn(async () => undefined),
      },
      persist: vi.fn(),
    });

    const navigation = reader.dispatch({ type: 'goToPage', page: 9 });
    await vi.waitFor(() => expect(finishNavigation).toBeTypeOf('function'));
    const close = reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });

    expect(navigationOptions?.isCancelled?.()).toBe(true);
    finishNavigation?.();
    await expect(close).resolves.toMatchObject({ status: 'committed' });
    await expect(navigation).resolves.toMatchObject({ status: 'no-op' });
  });

  it('cancels in-flight visual work as soon as semantic close is dispatched', async () => {
    let finishViewMode: (() => void) | undefined;
    let viewModeOptions: { isCancelled?: () => boolean } | undefined;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        applyViewMode: vi.fn((_filePath, _viewMode, options) => {
          viewModeOptions = options;
          return new Promise<void>((resolve) => {
            finishViewMode = resolve;
          });
        }),
        closeDocument: vi.fn(async () => undefined),
      },
      persist: vi.fn(),
    });

    const viewMode = reader.dispatch({ type: 'cycleViewMode' });
    await vi.waitFor(() => expect(finishViewMode).toBeTypeOf('function'));
    const close = reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });

    expect(viewModeOptions?.isCancelled?.()).toBe(true);
    finishViewMode?.();
    await expect(close).resolves.toMatchObject({ status: 'committed' });
    await expect(viewMode).resolves.toMatchObject({ status: 'no-op' });
  });

  it('rejects later settled state while a Document close is in flight', async () => {
    let releaseClose: (() => void) | undefined;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        closeDocument: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseClose = resolve;
            }),
        ),
      },
      persist: vi.fn(),
    });

    const removal = reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });
    await vi.waitFor(() => expect(releaseClose).toBeTypeOf('function'));
    const settled = reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/first.pdf',
      readingPosition: { page: 10, location: 0.5 },
    });
    let settledResolved = false;
    void settled.then(() => {
      settledResolved = true;
    });
    await Promise.resolve();

    expect(settledResolved).toBe(false);
    releaseClose?.();
    await expect(removal).resolves.toMatchObject({ status: 'committed', revision: 1 });
    await expect(settled).resolves.toMatchObject({ status: 'no-op', revision: 1 });
    expect(reader.snapshot().documents).toEqual([
      expect.objectContaining(INITIAL_SESSION.documents[1]),
    ]);
  });

  it('preserves later actions when a Document close fails', async () => {
    let rejectClose: ((error: Error) => void) | undefined;
    const reader = createReaderActions({
      initialSession: INITIAL_SESSION,
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        closeDocument: vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectClose = reject;
            }),
        ),
      },
      persist: vi.fn(),
    });

    const removal = reader.dispatch({ type: 'closeDocument', filePath: '/docs/first.pdf' });
    await vi.waitFor(() => expect(rejectClose).toBeTypeOf('function'));
    const settled = reader.dispatch({
      type: 'settleReadingPosition',
      filePath: '/docs/first.pdf',
      readingPosition: { page: 6, location: 0.5 },
    });
    rejectClose?.(new Error('close failed'));

    await expect(removal).resolves.toMatchObject({ status: 'failure', revision: 0 });
    await expect(settled).resolves.toMatchObject({ status: 'committed', revision: 1 });
    expect(reader.snapshot().documents[0].readingPosition).toEqual({ page: 6, location: 0.5 });
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

  it('projects manual Zoom Intent before committing and keeps settled state on failure', async () => {
    const events: string[] = [];
    const applyZoomIntent = vi.fn(async (_filePath, zoomIntent) => {
      events.push(`render:${zoomIntent.kind}`);
      if (zoomIntent.kind === 'manual' && zoomIntent.scale === 2) {
        throw new Error('zoom render failed');
      }
      return zoomIntent;
    });
    const reader = createReaderActions({
      initialSession: {
        ...INITIAL_SESSION,
        documents: INITIAL_SESSION.documents.map((document) => ({
          ...document,
          visualState: {
            filterSettings: {
              brightness: 0,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 0,
            },
            zoomIntent: { kind: 'manual' as const, scale: 1 },
            rotation: 0,
            viewMode: 'single' as const,
          },
        })),
      },
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        applyZoomIntent,
      },
      persist: vi.fn(),
    });
    reader.observe((snapshot) => {
      events.push(`commit:${snapshot.revision}`);
    });

    const committed = await reader.dispatch({
      type: 'setZoomIntent',
      zoomIntent: { kind: 'manual', scale: 1.5 },
    });
    const failed = await reader.dispatch({
      type: 'setZoomIntent',
      zoomIntent: { kind: 'manual', scale: 2 },
    });

    expect(committed).toMatchObject({ status: 'committed', revision: 1 });
    expect(failed).toMatchObject({ status: 'failure', revision: 1 });
    expect(events).toEqual(['render:manual', 'commit:1', 'render:manual']);
    expect(reader.snapshot().documents[0].visualState?.zoomIntent).toEqual({
      kind: 'manual',
      scale: 1.5,
    });
  });

  it('reprojects an unchanged fit intent so it recalculates for the current viewport', async () => {
    const applyZoomIntent = vi.fn(async (_filePath, zoomIntent) => zoomIntent);
    const reader = createReaderActions({
      initialSession: {
        ...INITIAL_SESSION,
        documents: INITIAL_SESSION.documents.map((document) => ({
          ...document,
          visualState: {
            filterSettings: {
              brightness: 0,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 0,
            },
            zoomIntent: { kind: 'fit-width' as const },
            rotation: 0,
            viewMode: 'single' as const,
          },
        })),
      },
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        applyZoomIntent,
      },
      persist: vi.fn(),
    });

    const outcome = await reader.dispatch({
      type: 'setZoomIntent',
      zoomIntent: { kind: 'fit-width' },
    });

    expect(applyZoomIntent).toHaveBeenCalledWith(
      '/docs/first.pdf',
      { kind: 'fit-width' },
      expect.objectContaining({ isCancelled: expect.any(Function) }),
    );
    expect(outcome).toMatchObject({ status: 'no-op', revision: 0 });
  });

  it('orders relative zoom and rotation while committing the resolved Visual State', async () => {
    let scale = 1;
    const applyRelativeZoom = vi.fn(async (_filePath, direction: 'in' | 'out') => {
      scale += direction === 'in' ? 0.25 : -0.25;
      return { kind: 'manual' as const, scale };
    });
    const applyRotation = vi.fn(async (_filePath: string, _rotation: number) => undefined);
    const reader = createReaderActions({
      initialSession: {
        ...INITIAL_SESSION,
        documents: INITIAL_SESSION.documents.map((document) => ({
          ...document,
          visualState: {
            filterSettings: {
              brightness: 0,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 0,
            },
            zoomIntent: { kind: 'manual' as const, scale: 1 },
            rotation: 0,
            viewMode: 'single' as const,
          },
        })),
      },
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        applyRelativeZoom,
        applyRotation,
      },
      persist: vi.fn(),
    });

    await reader.dispatch({ type: 'zoomIn' });
    await reader.dispatch({ type: 'zoomIn' });
    await reader.dispatch({ type: 'rotateClockwise' });
    await reader.dispatch({ type: 'rotateCounterClockwise' });

    expect(applyRelativeZoom.mock.calls.map((call) => call[1])).toEqual(['in', 'in']);
    expect(applyRotation.mock.calls.map((call) => call[1])).toEqual([90, 0]);
    expect(reader.snapshot().documents[0].visualState).toMatchObject({
      zoomIntent: { kind: 'manual', scale: 1.5 },
      rotation: 0,
    });
  });

  it('routes view mode and visual filters without admitting transient reader state', async () => {
    const applyViewMode = vi.fn(async () => undefined);
    const applyFilterSettings = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: {
        ...INITIAL_SESSION,
        documents: INITIAL_SESSION.documents.map((document) => ({
          ...document,
          visualState: {
            filterSettings: {
              brightness: 0,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 0,
            },
            zoomIntent: { kind: 'fit-width' as const },
            rotation: 0,
            viewMode: 'single' as const,
          },
        })),
      },
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        applyViewMode,
        applyFilterSettings,
      },
      persist: vi.fn(),
    });
    const filterSettings = {
      brightness: 10,
      grayscale: 20,
      invert: 30,
      sepia: 40,
      hue: 50,
      extraBrightness: 60,
    };

    await reader.dispatch({ type: 'setViewMode', viewMode: 'continuous' });
    await reader.dispatch({ type: 'setFilterSettings', filterSettings });

    expect(applyViewMode).toHaveBeenCalledWith(
      '/docs/first.pdf',
      'continuous',
      expect.objectContaining({ isCancelled: expect.any(Function) }),
    );
    expect(applyFilterSettings).toHaveBeenCalledWith(
      '/docs/first.pdf',
      filterSettings,
      expect.objectContaining({ isCancelled: expect.any(Function) }),
    );
    expect(Object.keys(reader.snapshot().documents[0].visualState ?? {}).sort()).toEqual([
      'filterSettings',
      'rotation',
      'viewMode',
      'zoomIntent',
    ]);
  });

  it('restores each Document Visual State independently through activation', async () => {
    const activateDocument = vi.fn(async () => undefined);
    const reader = createReaderActions({
      initialSession: {
        ...INITIAL_SESSION,
        documents: INITIAL_SESSION.documents.map((document, index) => ({
          ...document,
          visualState: {
            filterSettings: {
              brightness: index,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 0,
            },
            zoomIntent:
              index === 0
                ? { kind: 'manual' as const, scale: 1.75 }
                : { kind: 'fit-page' as const },
            rotation: index * 90,
            viewMode: index === 0 ? ('continuous' as const) : ('spread' as const),
          },
        })),
      },
      projection: { activateDocument, goToReadingPosition: vi.fn() },
      persist: vi.fn(),
    });

    await reader.dispatch({ type: 'activateDocument', filePath: '/docs/second.pdf' });

    expect(activateDocument).toHaveBeenCalledWith(
      '/docs/second.pdf',
      { page: 7, location: 0.5 },
      expect.objectContaining({
        zoomIntent: { kind: 'fit-page' },
        rotation: 90,
        viewMode: 'spread',
      }),
    );
    expect(reader.snapshot().documents[0].visualState).toMatchObject({
      zoomIntent: { kind: 'manual', scale: 1.75 },
      rotation: 0,
      viewMode: 'continuous',
    });
  });

  it('coalesces queued absolute Zoom Intent and lets other Documents progress', async () => {
    let releaseNavigation: (() => void) | undefined;
    const applied: string[] = [];
    const reader = createReaderActions({
      initialSession: {
        ...INITIAL_SESSION,
        documents: INITIAL_SESSION.documents.map((document) => ({
          ...document,
          visualState: {
            filterSettings: {
              brightness: 0,
              grayscale: 0,
              invert: 0,
              sepia: 0,
              hue: 0,
              extraBrightness: 0,
            },
            zoomIntent: { kind: 'manual' as const, scale: 1 },
            rotation: 0,
            viewMode: 'single' as const,
          },
        })),
      },
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseNavigation = resolve;
            }),
        ),
        applyZoomIntent: vi.fn(async (filePath, zoomIntent) => {
          applied.push(`${filePath}:${zoomIntent.kind}`);
          return zoomIntent;
        }),
      },
      persist: vi.fn(),
    });

    const navigation = reader.dispatch({ type: 'goToPage', page: 3 });
    await vi.waitFor(() => expect(releaseNavigation).toBeTypeOf('function'));
    const obsolete = reader.dispatch({
      type: 'setZoomIntent',
      zoomIntent: { kind: 'manual', scale: 1.25 },
    });
    const newest = reader.dispatch({ type: 'setZoomIntent', zoomIntent: { kind: 'fit-width' } });
    const independent = reader.dispatch({
      type: 'setZoomIntent',
      filePath: '/docs/second.pdf',
      zoomIntent: { kind: 'fit-page' },
    });

    await expect(independent).resolves.toMatchObject({ status: 'committed', revision: 1 });
    expect(applied).toEqual(['/docs/second.pdf:fit-page']);
    releaseNavigation?.();
    await expect(navigation).resolves.toMatchObject({ status: 'committed' });
    await expect(obsolete).resolves.toMatchObject({ status: 'superseded' });
    await expect(newest).resolves.toMatchObject({ status: 'committed' });
    expect(applied).toEqual(['/docs/second.pdf:fit-page', '/docs/first.pdf:fit-width']);
  });
});
