import { describe, expect, it, vi } from 'vitest';
import { createPersistenceCoordinator } from '../app/persistence-coordinator';

describe('application persistence coordinator', () => {
  it('settles the active Reading Position before flushing each durable authority', async () => {
    const events: string[] = [];
    const readerActions = {
      quiesce: vi.fn(async () => {
        events.push('quiesce');
      }),
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
    expect(events).toEqual(['quiesce', 'settle', 'session', 'annotations', 'recent']);
  });

  it('settles accepted work but skips Reading Session persistence when disabled', async () => {
    const events: string[] = [];
    const readerActions = {
      quiesce: vi.fn(async () => {
        events.push('quiesce');
      }),
      dispatch: vi.fn(async () => {
        events.push('settle');
        return { status: 'committed' as const, revision: 1 };
      }),
      flush: vi.fn(async () => {
        events.push('session');
      }),
    };
    const coordinator = createPersistenceCoordinator({
      readerActions: () => readerActions as never,
      annotations: () =>
        ({
          flush: vi.fn(async () => {
            events.push('annotations');
          }),
        }) as never,
      recentDocuments: () =>
        ({
          flush: vi.fn(async () => {
            events.push('recent');
          }),
        }) as never,
      activeReadingPosition: () => ({
        filePath: '/docs/report.pdf',
        readingPosition: { page: 4, location: 0.25 },
      }),
      shouldPersistReadingSession: () => false,
    });

    await coordinator.flush();

    expect(events).toEqual(['quiesce', 'annotations', 'recent']);
    expect(readerActions.dispatch).not.toHaveBeenCalled();
    expect(readerActions.flush).not.toHaveBeenCalled();
  });
});
