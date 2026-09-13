import type { ReaderActions, ReadingPosition } from '../reader/reader-actions';
import type { RecentDocumentAuthority } from '../reader/recent-documents';

interface PersistenceCoordinatorOptions {
  readerActions: () => ReaderActions | null;
  recentDocuments: () => RecentDocumentAuthority | null;
  activeReadingPosition: () => { filePath: string; readingPosition: ReadingPosition } | null;
  shouldPersistReadingSession: () => boolean;
}

export interface PersistenceCoordinator {
  flush(): Promise<void>;
}

export function createPersistenceCoordinator(
  options: PersistenceCoordinatorOptions,
): PersistenceCoordinator {
  return {
    async flush() {
      const failures: unknown[] = [];
      const actions = options.readerActions();
      try {
        await actions?.quiesce();
        if (actions && options.shouldPersistReadingSession()) {
          const observedPosition = options.activeReadingPosition();
          if (observedPosition) {
            await actions.dispatch({ type: 'settleReadingPosition', ...observedPosition });
          }
          await actions.flush();
        }
      } catch (error) {
        failures.push(error);
      }

      try {
        await options.recentDocuments()?.flush();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Failed to flush one or more durable authorities');
      }
    },
  };
}
