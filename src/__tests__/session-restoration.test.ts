import { describe, expect, it, vi } from 'vitest';
import { createDocumentIntake, type DocumentRuntimeIntake } from '../reader/document-intake';
import type {
  PersistedReadingSession,
  ReadingSessionDocument,
  ReadingSessionVisualState,
} from '../reader/reader-actions';

function visualState(viewMode: 'single' | 'continuous' | 'spread'): ReadingSessionVisualState {
  return {
    filterSettings: {
      brightness: 0,
      grayscale: 0,
      invert: 100,
      sepia: 0,
      hue: 0,
      extraBrightness: 0,
    },
    zoomIntent: { kind: 'fit-width' },
    rotation: 0,
    viewMode,
  };
}

function savedDocument(
  filePath: string,
  page: number,
  options: {
    location?: number;
    viewMode?: 'single' | 'continuous' | 'spread';
  } = {},
): ReadingSessionDocument {
  return {
    filePath,
    title: filePath.split('/').pop() ?? filePath,
    readingPosition: { page, location: options.location ?? 0.25 },
    visualState: visualState(options.viewMode ?? 'continuous'),
  };
}

function createRestoringIntake(
  runtimeOverrides: Partial<DocumentRuntimeIntake> = {},
  sourceOverrides: {
    describe?: (path: string) => Promise<{ canonicalPath: string; title: string }>;
    read?: (path: string) => Promise<Uint8Array>;
  } = {},
) {
  const runtime: DocumentRuntimeIntake = {
    isOpen: vi.fn(() => false),
    activate: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    goToPage: vi.fn(async () => undefined),
    notifyOpened: vi.fn(async () => undefined),
    canonicalizeDocumentPaths: vi.fn(async () => undefined),
    setDocumentOrder: vi.fn(),
    ...runtimeOverrides,
  };
  const intake = createDocumentIntake({
    source: {
      describe:
        sourceOverrides.describe ??
        (async (path: string) => ({
          canonicalPath: path,
          title: path.split('/').pop() ?? path,
        })),
      read: sourceOverrides.read ?? (async () => new Uint8Array([1])),
    },
    runtime,
  });

  return { intake, runtime };
}

describe('Reading Session restoration', () => {
  it('intakes the explicit startup Document first with saved Visual State and page precedence', async () => {
    const events: string[] = [];
    const { intake, runtime } = createRestoringIntake(
      {
        open: vi.fn(async ({ document }) => {
          events.push(`open:${document.canonicalPath}`);
        }),
      },
      {
        describe: async (path) => {
          events.push(`describe:${path}`);
          return { canonicalPath: path, title: path.split('/').pop() ?? path };
        },
        read: async (path) => {
          events.push(`read:${path}`);
          return new Uint8Array([1]);
        },
      },
    );
    const explicit = savedDocument('/docs/explicit.pdf', 4, { viewMode: 'spread' });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/saved-active.pdf',
      documents: [
        savedDocument('/docs/other.pdf', 3),
        savedDocument('/docs/saved-active.pdf', 7),
        explicit,
      ],
    };

    await intake.restore(session, {
      explicitRequests: [{ paths: ['/docs/explicit.pdf'], page: 12 }],
    });

    expect(events.indexOf('open:/docs/explicit.pdf')).toBeLessThan(
      events.indexOf('read:/docs/saved-active.pdf'),
    );
    expect(runtime.open).toHaveBeenNthCalledWith(1, {
      document: { canonicalPath: '/docs/explicit.pdf', title: 'explicit.pdf' },
      bytes: expect.any(Uint8Array),
      activate: true,
      initialPage: 12,
      notifyOpened: true,
      restoredDocument: {
        ...explicit,
        readingPosition: { page: 12, location: 0 },
      },
    });
    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(([request]) => ({
        filePath: request.document.canonicalPath,
        activate: request.activate,
      })),
    ).toEqual([
      { filePath: '/docs/explicit.pdf', activate: true },
      { filePath: '/docs/saved-active.pdf', activate: false },
      { filePath: '/docs/other.pdf', activate: false },
    ]);
  });

  it('activates the saved active Document before starting background restoration', async () => {
    const events: string[] = [];
    const { intake, runtime } = createRestoringIntake();
    (runtime.open as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ document, activate }) => {
        events.push(`open:${document.canonicalPath}:${activate}`);
      },
    );
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/saved-active.pdf',
      documents: [
        savedDocument('/docs/explicit.pdf', 4),
        savedDocument('/docs/saved-active.pdf', 7),
      ],
    };

    await intake.restore(session);

    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(
        ([request]) => request.document.canonicalPath,
      ),
    ).toEqual(['/docs/saved-active.pdf', '/docs/explicit.pdf']);
    expect(events).toEqual(['open:/docs/saved-active.pdf:true', 'open:/docs/explicit.pdf:false']);
    expect(runtime.activate).not.toHaveBeenCalled();
  });

  it('reports foreground readiness before background restoration completes', async () => {
    let releaseBackground: (() => void) | undefined;
    let backgroundStarted = false;
    const { intake } = createRestoringIntake({
      open: vi.fn(async ({ document }) => {
        if (document.canonicalPath === '/docs/background.pdf') {
          backgroundStarted = true;
          await new Promise<void>((resolve) => {
            releaseBackground = resolve;
          });
        }
      }),
    });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/active.pdf',
      documents: [savedDocument('/docs/active.pdf', 2), savedDocument('/docs/background.pdf', 3)],
    };

    const operation = intake.beginRestore(session);

    await expect(operation.foreground).resolves.toMatchObject({
      status: 'opened',
      filePath: '/docs/active.pdf',
    });
    expect(backgroundStarted).toBe(false);
    await vi.waitFor(() => expect(releaseBackground).toBeTypeOf('function'));
    let completed = false;
    void operation.completion.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    releaseBackground?.();
    await operation.completion;
  });

  it('restores the saved active Document before a background saved describe can block it', async () => {
    let releaseBackgroundDescribe: (() => void) | undefined;
    const { intake, runtime } = createRestoringIntake(
      {},
      {
        describe: async (path) => {
          if (path === '/docs/background.pdf') {
            await new Promise<void>((resolve) => {
              releaseBackgroundDescribe = resolve;
            });
          }
          return { canonicalPath: path, title: path.split('/').pop() ?? path };
        },
      },
    );
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/active.pdf',
      documents: [
        savedDocument('/docs/background.pdf', 1),
        savedDocument('/docs/active.pdf', 2),
      ],
    };

    const operation = intake.beginRestore(session);

    await expect(operation.foreground).resolves.toMatchObject({
      status: 'opened',
      filePath: '/docs/active.pdf',
    });
    expect(runtime.open).toHaveBeenCalledTimes(1);
    expect(runtime.open).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ canonicalPath: '/docs/active.pdf' }),
        activate: true,
      }),
    );

    await vi.waitFor(() => expect(releaseBackgroundDescribe).toBeTypeOf('function'));
    releaseBackgroundDescribe?.();
    await expect(operation.completion).resolves.toMatchObject({ opened: 2, failed: 0 });
  });

  it('preserves explicit request order before restoring the saved active Document', async () => {
    const opened = new Set<string>();
    const { intake, runtime } = createRestoringIntake({
      isOpen: vi.fn((filePath: string) => opened.has(filePath)),
      open: vi.fn(async ({ document }) => {
        opened.add(document.canonicalPath);
      }),
    });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/saved-active.pdf',
      documents: [savedDocument('/docs/saved-active.pdf', 5)],
    };

    await intake.restore(session, {
      explicitRequests: [{ paths: ['/docs/first.pdf', '/docs/second.pdf'] }],
    });

    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(
        ([request]) => request.document.canonicalPath,
      ),
    ).toEqual(['/docs/first.pdf', '/docs/second.pdf', '/docs/saved-active.pdf']);
  });

  it('preserves explicit request FIFO when the saved active Document is also requested later', async () => {
    const opened = new Set<string>();
    const { intake, runtime } = createRestoringIntake({
      isOpen: vi.fn((filePath: string) => opened.has(filePath)),
      open: vi.fn(async ({ document }) => {
        opened.add(document.canonicalPath);
      }),
    });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/saved-active.pdf',
      documents: [savedDocument('/docs/saved-active.pdf', 5)],
    };

    const result = await intake.restore(session, {
      explicitRequests: [
        { paths: ['/docs/first.pdf', '/docs/second.pdf', '/docs/saved-active.pdf'] },
      ],
    });

    expect(result.explicitRequestResult.outcomes.map(({ requestedPath }) => requestedPath)).toEqual(
      ['/docs/first.pdf', '/docs/second.pdf', '/docs/saved-active.pdf'],
    );
    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(
        ([request]) => request.document.canonicalPath,
      ),
    ).toEqual(['/docs/first.pdf', '/docs/second.pdf', '/docs/saved-active.pdf']);
    expect(runtime.open).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        document: expect.objectContaining({ canonicalPath: '/docs/saved-active.pdf' }),
        notifyOpened: true,
      }),
    );
  });

  it('restores remaining Documents strictly sequentially in saved order', async () => {
    let releaseFirstBackground: (() => void) | undefined;
    const started: string[] = [];
    const { intake, runtime } = createRestoringIntake({
      open: vi.fn(async ({ document }) => {
        started.push(document.canonicalPath);
        if (document.canonicalPath === '/docs/one.pdf') {
          await new Promise<void>((resolve) => {
            releaseFirstBackground = resolve;
          });
        }
      }),
    });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/active.pdf',
      documents: [
        savedDocument('/docs/one.pdf', 1),
        savedDocument('/docs/active.pdf', 2),
        savedDocument('/docs/two.pdf', 3),
      ],
    };

    const restoration = intake.restore(session);
    await vi.waitFor(() => expect(started).toEqual(['/docs/active.pdf', '/docs/one.pdf']));
    expect(started).not.toContain('/docs/two.pdf');
    releaseFirstBackground?.();
    await restoration;

    expect(started).toEqual(['/docs/active.pdf', '/docs/one.pdf', '/docs/two.pdf']);
    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(([request]) => request.activate),
    ).toEqual([true, false, false]);
  });

  it('keeps automatic restoration quiet while explicit startup intake remains observable', async () => {
    const { intake, runtime } = createRestoringIntake();
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/saved.pdf',
      documents: [savedDocument('/docs/saved.pdf', 2)],
    };

    await intake.restore(session, {
      explicitRequests: [{ paths: ['/docs/explicit.pdf'] }],
    });

    expect(runtime.open).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        document: expect.objectContaining({ canonicalPath: '/docs/explicit.pdf' }),
        notifyOpened: true,
      }),
    );
    expect(runtime.open).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        document: expect.objectContaining({ canonicalPath: '/docs/saved.pdf' }),
        notifyOpened: false,
      }),
    );
  });

  it('does not retry a missing saved Document after its explicit startup request fails', async () => {
    const describe = vi.fn(async () => {
      throw new Error('missing');
    });
    const { intake } = createRestoringIntake({}, { describe });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/missing.pdf',
      documents: [savedDocument('/docs/missing.pdf', 3)],
    };

    const result = await intake.restore(session, {
      explicitRequests: [{ paths: ['/docs/missing.pdf'] }],
    });

    expect(describe).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      failed: 1,
      failedPaths: ['/docs/missing.pdf'],
      explicitRequestResult: { failed: 1 },
    });
  });

  it('intakes a canonical alias with saved Visual State before foreground readiness', async () => {
    const saved = savedDocument('/alias/report.pdf', 3, { viewMode: 'spread' });
    const { intake, runtime } = createRestoringIntake(
      {},
      {
        describe: async (path) => ({
          canonicalPath: '/docs/report.pdf',
          title: path.split('/').pop() ?? path,
        }),
      },
    );
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/alias/report.pdf',
      documents: [saved],
    };

    const operation = intake.beginRestore(session, {
      explicitRequests: [{ paths: ['/docs/report.pdf'], page: 9 }],
    });

    await expect(operation.foreground).resolves.toMatchObject({
      status: 'opened',
      filePath: '/docs/report.pdf',
    });
    await operation.completion;

    expect(runtime.open).toHaveBeenCalledOnce();
    expect(runtime.open).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPage: 9,
        restoredDocument: expect.objectContaining({
          filePath: '/docs/report.pdf',
          readingPosition: { page: 9, location: 0 },
          visualState: saved.visualState,
        }),
      }),
    );
    expect(runtime.canonicalizeDocumentPaths).toHaveBeenCalledWith([
      {
        requestedPath: '/alias/report.pdf',
        canonicalPath: '/docs/report.pdf',
        runtimeStateSource: 'canonical',
      },
    ]);
  });

  it('keeps explicit page state authoritative when a saved alias canonicalizes', async () => {
    const { intake, runtime } = createRestoringIntake(
      {},
      {
        describe: async (path) => ({
          canonicalPath: '/docs/report.pdf',
          title: path.split('/').pop() ?? path,
        }),
      },
    );
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/alias/report.pdf',
      documents: [savedDocument('/alias/report.pdf', 3)],
    };

    await intake.restore(session, {
      explicitRequests: [{ paths: ['/docs/report.pdf'], page: 9 }],
    });

    expect(runtime.open).toHaveBeenCalledOnce();
    expect(runtime.open).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPage: 9,
        notifyOpened: true,
        restoredDocument: expect.objectContaining({
          readingPosition: { page: 9, location: 0 },
        }),
      }),
    );
    expect(runtime.canonicalizeDocumentPaths).toHaveBeenCalledWith([
      {
        requestedPath: '/alias/report.pdf',
        canonicalPath: '/docs/report.pdf',
        runtimeStateSource: 'canonical',
      },
    ]);
  });

  it('applies an explicit page only to the first Document in that startup request', async () => {
    const { intake, runtime } = createRestoringIntake();
    const first = savedDocument('/docs/first.pdf', 3);
    const second = savedDocument('/docs/second.pdf', 8);
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/second.pdf',
      documents: [first, second],
    };

    const result = await intake.restore(session, {
      explicitRequests: [{ paths: ['/docs/first.pdf', '/docs/second.pdf'], page: 12 }],
    });

    expect(runtime.open).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        initialPage: 12,
        restoredDocument: expect.objectContaining({
          readingPosition: { page: 12, location: 0 },
        }),
      }),
    );
    expect(runtime.open).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        notifyOpened: true,
        restoredDocument: expect.objectContaining({ readingPosition: second.readingPosition }),
      }),
    );
    expect((runtime.open as ReturnType<typeof vi.fn>).mock.calls[1][0]).not.toHaveProperty(
      'initialPage',
    );
    expect(runtime.goToPage).not.toHaveBeenCalled();
    expect(result.explicitRequestResult.outcomes.map(({ requestedPath }) => requestedPath)).toEqual(
      ['/docs/first.pdf', '/docs/second.pdf'],
    );
  });

  it('deduplicates restored aliases by canonical Document identity', async () => {
    let canonicalOpen = false;
    const { intake, runtime } = createRestoringIntake(
      {
        isOpen: vi.fn((filePath: string) => canonicalOpen && filePath === '/docs/report.pdf'),
        open: vi.fn(async () => {
          canonicalOpen = true;
        }),
      },
      {
        describe: async (path: string) => ({
          canonicalPath: '/docs/report.pdf',
          title: path.split('/').pop() ?? path,
        }),
      },
    );
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/alias/report.pdf',
      documents: [
        savedDocument('/alias/report.pdf', 3),
        savedDocument('/other-alias/report.pdf', 8),
      ],
    };

    const result = await intake.restore(session);

    expect(runtime.open).toHaveBeenCalledOnce();
    expect(runtime.activate).not.toHaveBeenCalled();
    expect(runtime.open).toHaveBeenCalledWith(
      expect.objectContaining({ activate: true, notifyOpened: false }),
    );
    expect(runtime.canonicalizeDocumentPaths).toHaveBeenCalledWith([
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
    expect(runtime.setDocumentOrder).toHaveBeenCalledWith(['/docs/report.pdf']);
    expect(result).toMatchObject({ opened: 2, failed: 0, failedPaths: [] });
  });

  it('returns every failed restored path for authoritative pruning', async () => {
    const { intake, runtime } = createRestoringIntake(
      {},
      {
        describe: async (path: string) => {
          if (path === '/docs/missing.pdf') throw new Error('missing');
          return { canonicalPath: path, title: path.split('/').pop() ?? path };
        },
      },
    );
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/missing.pdf',
      documents: [savedDocument('/docs/missing.pdf', 1), savedDocument('/docs/kept.pdf', 9)],
    };

    const result = await intake.restore(session);

    expect(runtime.open).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      opened: 1,
      failed: 1,
      failedPaths: ['/docs/missing.pdf'],
      outcomes: [
        expect.objectContaining({
          status: 'failed',
          requestedPath: '/docs/missing.pdf',
        }),
        expect.objectContaining({ status: 'opened', requestedPath: '/docs/kept.pdf' }),
      ],
    });
  });

  it('waits for encrypted restoration, then prunes cancellation and continues without a password', async () => {
    let cancelPassword: (() => void) | undefined;
    const open = vi.fn(async (request) => {
      expect(request).not.toHaveProperty('password');
      if (request.document.canonicalPath === '/docs/one.pdf') {
        await new Promise<void>((_resolve, reject) => {
          cancelPassword = () => reject(new Error('Password entry cancelled'));
        });
      }
    });
    const { intake, runtime } = createRestoringIntake({ open });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/one.pdf',
      documents: [savedDocument('/docs/one.pdf', 1), savedDocument('/docs/two.pdf', 2)],
    };

    const restoration = intake.restore(session);
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    expect(open).not.toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ canonicalPath: '/docs/two.pdf' }),
      }),
    );
    cancelPassword?.();
    const result = await restoration;

    expect(runtime.open).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      opened: 1,
      failed: 1,
      failedPaths: ['/docs/one.pdf'],
    });
  });

  it('does not canonicalize a restored alias whose transactional open failed', async () => {
    const { intake, runtime } = createRestoringIntake(
      {
        open: vi.fn(async () => {
          throw new Error('first render failed');
        }),
      },
      {
        describe: async () => ({ canonicalPath: '/docs/report.pdf', title: 'report.pdf' }),
      },
    );
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/alias/report.pdf',
      documents: [savedDocument('/alias/report.pdf', 3)],
    };

    const result = await intake.restore(session);

    expect(runtime.canonicalizeDocumentPaths).toHaveBeenCalledWith([]);
    expect(result).toMatchObject({
      opened: 0,
      failed: 1,
      failedPaths: ['/alias/report.pdf'],
    });
  });
});
