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
    restoreDocumentState: vi.fn(async () => ({ status: 'restored' as const })),
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
  it('restores the saved active Document first without stealing explicit startup activation', async () => {
    const restoreCalls: Array<{
      filePath: string;
      preserveCurrentReadingPosition: boolean;
    }> = [];
    const { intake, runtime } = createRestoringIntake({
      restoreDocumentState: vi.fn(async (document, options) => {
        restoreCalls.push({
          filePath: document.filePath,
          preserveCurrentReadingPosition: options.preserveCurrentReadingPosition,
        });
        return { status: 'restored' as const };
      }),
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
      preserveForegroundReadingPosition: true,
    });

    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(
        ([document]) => document.canonicalPath,
      ),
    ).toEqual(['/docs/saved-active.pdf', '/docs/other.pdf', '/docs/explicit.pdf']);
    expect(
      (runtime.open as ReturnType<typeof vi.fn>).mock.calls.map(([, , activate]) => activate),
    ).toEqual([false, false, true]);
    expect(restoreCalls).toEqual([
      {
        filePath: '/docs/saved-active.pdf',
        preserveCurrentReadingPosition: false,
      },
      {
        filePath: '/docs/other.pdf',
        preserveCurrentReadingPosition: false,
      },
      {
        filePath: '/docs/explicit.pdf',
        preserveCurrentReadingPosition: true,
      },
    ]);
    expect(runtime.setDocumentOrder).toHaveBeenCalledWith([
      '/docs/other.pdf',
      '/docs/saved-active.pdf',
      '/docs/explicit.pdf',
    ]);
    expect(runtime.activate).toHaveBeenCalledWith('/docs/explicit.pdf');
    expect(result).toEqual({ opened: 3, failed: 0, failedPaths: [] });
  });

  it('uses the saved Reading Position when startup did not request an explicit page', async () => {
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
      preserveForegroundReadingPosition: false,
    });

    expect(runtime.restoreDocumentState).toHaveBeenNthCalledWith(
      2,
      session.documents[0],
      expect.objectContaining({ preserveCurrentReadingPosition: false }),
    );
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

    expect(runtime.restoreDocumentState).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      opened: 1,
      failed: 1,
      failedPaths: ['/docs/missing.pdf'],
    });
  });

  it('continues after a thrown per-Document restore failure', async () => {
    const { intake, runtime } = createRestoringIntake({
      restoreDocumentState: vi
        .fn()
        .mockRejectedValueOnce(new Error('render failed'))
        .mockResolvedValueOnce({ status: 'restored' as const }),
    });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/one.pdf',
      documents: [savedDocument('/docs/one.pdf', 1), savedDocument('/docs/two.pdf', 2)],
    };

    const result = await intake.restore(session);

    expect(runtime.restoreDocumentState).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      opened: 1,
      failed: 1,
      failedPaths: ['/docs/one.pdf'],
    });
  });
});
