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
  it('restores the saved active Document first without reopening the explicit startup foreground', async () => {
    const { intake, runtime } = createRestoringIntake({
      isOpen: vi.fn((filePath: string) => filePath === '/docs/explicit.pdf'),
    });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/saved-active.pdf',
      documents: [
        savedDocument('/docs/other.pdf', 3, { location: 0.6 }),
        savedDocument('/docs/saved-active.pdf', 7),
        savedDocument('/docs/explicit.pdf', 4, { viewMode: 'spread' }),
      ],
    };

    const result = await intake.restore(session, {
      foregroundDocumentPath: '/docs/explicit.pdf',
    });

    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(
        ([request]) => request.document.canonicalPath,
      ),
    ).toEqual(['/docs/saved-active.pdf', '/docs/other.pdf']);
    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(([request]) => ({
        activate: request.activate,
        restored: request.restoredDocument?.filePath,
      })),
    ).toEqual([
      {
        activate: false,
        restored: '/docs/saved-active.pdf',
      },
      {
        activate: false,
        restored: '/docs/other.pdf',
      },
    ]);
    expect(runtime.setDocumentOrder).toHaveBeenCalledWith([
      '/docs/other.pdf',
      '/docs/saved-active.pdf',
      '/docs/explicit.pdf',
    ]);
    expect(runtime.activate).not.toHaveBeenCalled();
    expect(result).toEqual({ opened: 3, failed: 0, failedPaths: [] });
  });

  it('restores the saved active Document first when no explicit foreground is already open', async () => {
    const { intake, runtime } = createRestoringIntake();
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/saved-active.pdf',
      documents: [
        savedDocument('/docs/explicit.pdf', 4),
        savedDocument('/docs/saved-active.pdf', 7),
      ],
    };

    await intake.restore(session, {
      foregroundDocumentPath: '/docs/explicit.pdf',
    });

    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(
        ([request]) => request.document.canonicalPath,
      ),
    ).toEqual(['/docs/saved-active.pdf', '/docs/explicit.pdf']);
    expect(runtime.activate).toHaveBeenCalledWith('/docs/explicit.pdf', {
      notifyOpened: false,
    });
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
    expect(runtime.activate).toHaveBeenCalledWith('/docs/report.pdf', { notifyOpened: false });
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
    expect(result).toEqual({ opened: 2, failed: 0, failedPaths: [] });
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
    expect(result).toEqual({
      opened: 1,
      failed: 1,
      failedPaths: ['/docs/missing.pdf'],
    });
  });

  it('continues after a cancelled password prompt and prunes that Document', async () => {
    const { intake, runtime } = createRestoringIntake({
      open: vi
        .fn()
        .mockRejectedValueOnce(new Error('Password entry cancelled'))
        .mockResolvedValueOnce(undefined),
    });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/one.pdf',
      documents: [savedDocument('/docs/one.pdf', 1), savedDocument('/docs/two.pdf', 2)],
    };

    const result = await intake.restore(session);

    expect(runtime.open).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
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
    expect(result).toEqual({
      opened: 0,
      failed: 1,
      failedPaths: ['/alias/report.pdf'],
    });
  });
});
