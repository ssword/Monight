import { describe, expect, it, vi } from 'vitest';
import { createPersistenceCoordinator } from '../app/persistence-coordinator';

describe('application persistence coordinator', () => {
  it('settles the active Reading Position before flushing each durable authority', async () => {
    const events: string[] = [];
    const readerActions = {
      dispatch: vi.fn(async () => {
        events.push('settle');
        return { status: 'committed' as const, revision: 1 };
      }),
      flush: vi.fn(async () => {
        events.push('session');
      }),
    };
    const annotations = {
      flush: vi.fn(async () => {
        events.push('annotations');
      }),
    };
    const recentDocuments = {
      flush: vi.fn(async () => {
        events.push('recent');
      }),
    };
    const coordinator = createPersistenceCoordinator({
      readerActions: () => readerActions as never,
      annotations: () => annotations as never,
      recentDocuments: () => recentDocuments as never,
      activeReadingPosition: () => ({
        filePath: '/docs/report.pdf',
        readingPosition: { page: 4, location: 0.25 },
      }),
      shouldPersistReadingSession: () => true,
    });

    await coordinator.flush();

    expect(readerActions.dispatch).toHaveBeenCalledWith({
      type: 'settleReadingPosition',
      filePath: '/docs/report.pdf',
      readingPosition: { page: 4, location: 0.25 },
    });
    expect(events).toEqual(['settle', 'session', 'annotations', 'recent']);
  });
});
