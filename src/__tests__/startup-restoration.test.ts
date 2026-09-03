import { describe, expect, it, vi } from 'vitest';
import { restoreReadingSessionAtStartup } from '../app/startup-restoration';
import type { DocumentIntake } from '../reader/document-intake';
import type { PersistedReadingSession } from '../reader/reader-actions';

const emptySession: PersistedReadingSession = {
  schemaVersion: 2,
  activeDocumentPath: null,
  documents: [],
};

describe('startup Reading Session workflow', () => {
  it('prunes every failed restored Document before reporting one summary', async () => {
    const events: string[] = [];
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
      beginRestore: vi.fn(() => ({
        foreground: Promise.resolve({
          status: 'opened' as const,
          requestedPath: '/docs/kept.pdf',
          filePath: '/docs/kept.pdf',
        }),
        completion,
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
});
