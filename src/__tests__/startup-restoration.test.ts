import { describe, expect, it, vi } from 'vitest';
import { restoreReadingSessionAtStartup } from '../app/startup-restoration';
import {
  createDocumentIntake,
  type DocumentIntake,
  type DocumentRuntimeIntake,
} from '../reader/document-intake';
import type {
  PersistedReadingSession,
  ReadingSessionDocument,
  ReadingSessionVisualState,
} from '../reader/reader-actions';

const emptySession: PersistedReadingSession = {
  schemaVersion: 2,
  activeDocumentPath: null,
  documents: [],
};

function visualState(): ReadingSessionVisualState {
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
    viewMode: 'continuous',
  };
}

function savedDocument(filePath: string, page: number): ReadingSessionDocument {
  return {
    filePath,
    title: filePath.split('/').pop() ?? filePath,
    readingPosition: { page, location: 0.25 },
    visualState: visualState(),
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

describe('startup Reading Session workflow', () => {
  it('prunes every failed restored Document before reporting one summary', async () => {
    const events: string[] = [];
    const foregroundOutcome = {
      status: 'opened' as const,
      requestedPath: '/docs/kept.pdf',
      filePath: '/docs/kept.pdf',
    };
    let finishCompletion: (() => void) | undefined;
    const completion = new Promise<{
      outcomes: [];
      opened: number;
      failed: number;
      failedPaths: string[];
      explicitRequestResult: {
        outcomes: Array<{
          status: 'failed';
          requestedPath: string;
          error: Error;
        }>;
        opened: number;
        activated: number;
        failed: number;
      };
    }>((resolve) => {
      finishCompletion = () => {
        events.push('restore');
        resolve({
          outcomes: [],
          opened: 1,
          failed: 2,
          failedPaths: ['/docs/missing.pdf', '/docs/encrypted.pdf'],
          explicitRequestResult: {
            outcomes: [
              {
                status: 'failed',
                requestedPath: '/docs/requested.pdf',
                error: new Error('invalid PDF'),
              },
            ],
            opened: 0,
            activated: 0,
            failed: 1,
          },
        });
      };
    });
    const intake = {
      beginRestore: vi.fn((_session, options) => ({
        foreground: Promise.resolve(foregroundOutcome),
        completion: (async () => {
          await options?.onForegroundReady?.(foregroundOutcome);
          return completion;
        })(),
      })),
    } as unknown as DocumentIntake;
    const pruneDocument = vi.fn(async (filePath: string) => {
      events.push(`prune:${filePath}`);
    });
    const reportFailure = vi.fn((message: string) => {
      events.push(`report:${message}`);
    });

    await restoreReadingSessionAtStartup({
      intake,
      session: emptySession,
      explicitRequests: [{ paths: ['/docs/requested.pdf'] }],
      onForegroundReady: () => {
        events.push('foreground');
        finishCompletion?.();
      },
      pruneDocument,
      reportFailure,
    });

    expect(pruneDocument.mock.calls.map(([filePath]) => filePath)).toEqual([
      '/docs/missing.pdf',
      '/docs/encrypted.pdf',
    ]);
    expect(reportFailure).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledWith(
      'Failed to open 1 requested Document and pruned 2 saved Documents while restoring the Reading Session.',
    );
    expect(events).toEqual([
      'foreground',
      'restore',
      'prune:/docs/missing.pdf',
      'prune:/docs/encrypted.pdf',
      expect.stringMatching(/^report:/),
    ]);
  });

  it('does not display a restoration report when every Document succeeds', async () => {
    const intake = {
      beginRestore: vi.fn(() => ({
        foreground: Promise.resolve(null),
        completion: Promise.resolve({
          outcomes: [],
          opened: 2,
          failed: 0,
          failedPaths: [],
          explicitRequestResult: { outcomes: [], opened: 0, activated: 0, failed: 0 },
        }),
      })),
    } as unknown as DocumentIntake;
    const reportFailure = vi.fn();

    await restoreReadingSessionAtStartup({
      intake,
      session: emptySession,
      pruneDocument: vi.fn(async () => undefined),
      reportFailure,
    });

    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('waits for foreground startup work before continuing background restoration', async () => {
    const events: string[] = [];
    let releaseForegroundReady: (() => void) | undefined;
    let releaseBackgroundDescribe: (() => void) | undefined;
    const { intake, runtime } = createRestoringIntake(
      {
        open: vi.fn(async ({ document }) => {
          events.push(`open:${document.canonicalPath}`);
        }),
      },
      {
        describe: async (path) => {
          if (path === '/docs/background.pdf') {
            await new Promise<void>((resolve) => {
              releaseBackgroundDescribe = resolve;
            });
          }
          events.push(`describe:${path}`);
          return { canonicalPath: path, title: path.split('/').pop() ?? path };
        },
        read: async (path) => {
          events.push(`read:${path}`);
          return new Uint8Array([1]);
        },
      },
    );
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/active.pdf',
      documents: [
        savedDocument('/docs/active.pdf', 2),
        savedDocument('/docs/background.pdf', 3),
      ],
    };

    const restoration = restoreReadingSessionAtStartup({
      intake,
      session,
      onForegroundReady: async () => {
        events.push('foreground');
        await new Promise<void>((resolve) => {
          releaseForegroundReady = resolve;
        });
      },
      pruneDocument: vi.fn(async () => undefined),
      reportFailure: vi.fn(),
    });

    await vi.waitFor(() =>
      expect(events).toEqual([
        'describe:/docs/active.pdf',
        'read:/docs/active.pdf',
        'open:/docs/active.pdf',
        'foreground',
      ]),
    );
    expect(runtime.open).toHaveBeenCalledTimes(1);
    expect(events).not.toContain('describe:/docs/background.pdf');

    releaseForegroundReady?.();
    await vi.waitFor(() => expect(releaseBackgroundDescribe).toBeTypeOf('function'));
    releaseBackgroundDescribe?.();
    await expect(restoration).resolves.toMatchObject({ opened: 2, failed: 0 });
  });
});
