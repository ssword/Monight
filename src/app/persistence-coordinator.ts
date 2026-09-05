import type { AnnotationAuthority } from '../reader/annotations';
import type { ReaderActions, ReadingPosition } from '../reader/reader-actions';
import type { RecentDocumentAuthority } from '../reader/recent-documents';

interface PersistenceCoordinatorOptions {
  readerActions: () => ReaderActions | null;
  annotations: () => AnnotationAuthority | null;
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
      const actions = options.readerActions();
      if (actions && options.shouldPersistReadingSession()) {
        const observedPosition = options.activeReadingPosition();
        if (observedPosition) {
          await actions.dispatch({ type: 'settleReadingPosition', ...observedPosition });
        }
        await actions.flush();
      }

      await options.annotations()?.flush();
      await options.recentDocuments()?.flush();
    },
  };
}
