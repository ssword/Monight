import type { ViewMode } from '../lib/document-features';
import type { FilterSettings } from '../scripts/filters';

export interface ReadingPosition {
  readonly page: number;
  readonly location: number;
}

export interface LegacyReadingPosition {
  readonly page: number;
  readonly legacyOffset: number;
}

export type RestorableReadingPosition = ReadingPosition | LegacyReadingPosition;

export interface ReadingSessionVisualState {
  readonly filterSettings: Readonly<FilterSettings>;
  readonly zoom: number;
  readonly rotation: number;
  readonly viewMode: ViewMode;
}

export interface ReadingSessionDocument {
  readonly filePath: string;
  readonly title: string;
  readonly readingPosition: RestorableReadingPosition;
  readonly visualState?: ReadingSessionVisualState;
}

export interface PersistedReadingSession {
  readonly schemaVersion: 1;
  readonly activeDocumentPath: string | null;
  readonly documents: readonly ReadingSessionDocument[];
}

export interface ReadingSessionSnapshot extends PersistedReadingSession {
  readonly revision: number;
}

export interface ReaderProjection {
  activateDocument(filePath: string, position: RestorableReadingPosition): Promise<void>;
  goToReadingPosition(
    filePath: string,
    position: RestorableReadingPosition,
    options?: ReaderActionOptions,
  ): Promise<void>;
}

export interface ReaderActionOptions {
  readonly isCancelled?: () => boolean;
}

export type ReaderAction =
  | {
      type: 'activateDocument';
      filePath: string;
    }
  | {
      type: 'goToPage';
      page: number;
      filePath?: string;
    }
  | {
      type: 'settleReadingPosition';
      filePath: string;
      readingPosition: ReadingPosition;
    }
  | {
      type: 'registerDocument';
      document: ReadingSessionDocument;
    }
  | {
      type: 'removeDocument';
      filePath: string;
    };

export type ReaderActionOutcome =
  | { status: 'committed'; revision: number }
  | { status: 'no-op'; revision: number }
  | { status: 'failure'; error: unknown; revision: number };

interface CreateReaderActionsOptions {
  initialSession: PersistedReadingSession;
  projection: ReaderProjection;
  persist: (snapshot: ReadingSessionSnapshot) => Promise<void>;
  onObserverError?: (error: unknown) => void;
}

export interface ReaderActions {
  dispatch(action: ReaderAction, options?: ReaderActionOptions): Promise<ReaderActionOutcome>;
  snapshot(): ReadingSessionSnapshot;
  observe(observer: (snapshot: ReadingSessionSnapshot) => void): () => void;
}

function freezeSnapshot(
  session: PersistedReadingSession,
  revision: number,
): ReadingSessionSnapshot {
  const documents = session.documents.map((document) =>
    Object.freeze({
      ...document,
      readingPosition: Object.freeze({ ...document.readingPosition }),
      visualState: document.visualState
        ? Object.freeze({
            ...document.visualState,
            filterSettings: Object.freeze({ ...document.visualState.filterSettings }),
          })
        : undefined,
    }),
  );
  return Object.freeze({
    ...session,
    revision,
    documents: Object.freeze(documents),
  });
}

export function createReaderActions({
  initialSession,
  projection,
  persist,
  onObserverError = (error) => console.error('Reading Session observer failed:', error),
}: CreateReaderActionsOptions): ReaderActions {
  let snapshot = freezeSnapshot(initialSession, 0);
  const observers = new Set<(value: ReadingSessionSnapshot) => void>();
  let persistenceQueue = Promise.resolve();

  const commit = async (session: PersistedReadingSession): Promise<ReaderActionOutcome> => {
    snapshot = freezeSnapshot(session, snapshot.revision + 1);
    for (const observer of observers) {
      try {
        observer(snapshot);
      } catch (error) {
        onObserverError(error);
      }
    }
    const committedSnapshot = snapshot;
    persistenceQueue = persistenceQueue
      .catch(() => undefined)
      .then(() => persist(committedSnapshot));
    try {
      await persistenceQueue;
      return { status: 'committed', revision: committedSnapshot.revision };
    } catch (error) {
      return { status: 'failure', error, revision: committedSnapshot.revision };
    }
  };

  return {
    async dispatch(action, options) {
      if (action.type === 'removeDocument') {
        const index = snapshot.documents.findIndex((item) => item.filePath === action.filePath);
        if (index === -1) return { status: 'no-op', revision: snapshot.revision };
        const documents = snapshot.documents.filter((item) => item.filePath !== action.filePath);
        const activeDocumentPath =
          snapshot.activeDocumentPath === action.filePath
            ? (documents[Math.min(index, documents.length - 1)]?.filePath ?? null)
            : snapshot.activeDocumentPath;
        return await commit({ schemaVersion: 1, activeDocumentPath, documents });
      }

      if (action.type === 'registerDocument') {
        if (snapshot.documents.some((item) => item.filePath === action.document.filePath)) {
          return { status: 'no-op', revision: snapshot.revision };
        }
        return await commit({
          schemaVersion: 1,
          activeDocumentPath: snapshot.activeDocumentPath,
          documents: [...snapshot.documents, action.document],
        });
      }

      if (action.type === 'activateDocument') {
        const document = snapshot.documents.find((item) => item.filePath === action.filePath);
        if (!document) {
          return { status: 'no-op', revision: snapshot.revision };
        }

        try {
          await projection.activateDocument(document.filePath, document.readingPosition);
          if (snapshot.activeDocumentPath === document.filePath) {
            return { status: 'no-op', revision: snapshot.revision };
          }
          return await commit({
            schemaVersion: 1,
            activeDocumentPath: document.filePath,
            documents: snapshot.documents,
          });
        } catch (error) {
          return { status: 'failure', error, revision: snapshot.revision };
        }
      }

      if (action.type === 'settleReadingPosition') {
        const document = snapshot.documents.find((item) => item.filePath === action.filePath);
        const { page, location } = action.readingPosition;
        if (
          !document ||
          !Number.isInteger(page) ||
          page < 1 ||
          !Number.isFinite(location) ||
          location < 0 ||
          location > 1
        ) {
          return { status: 'no-op', revision: snapshot.revision };
        }
        if (
          'location' in document.readingPosition &&
          document.readingPosition.page === page &&
          document.readingPosition.location === location
        ) {
          return { status: 'no-op', revision: snapshot.revision };
        }
        const documents = snapshot.documents.map((item) =>
          item.filePath === document.filePath
            ? { ...item, readingPosition: { page, location } }
            : item,
        );
        return await commit({
          schemaVersion: 1,
          activeDocumentPath: snapshot.activeDocumentPath,
          documents,
        });
      }

      const targetPath = action.filePath ?? snapshot.activeDocumentPath;
      const document = snapshot.documents.find((item) => item.filePath === targetPath);
      if (!document || !Number.isInteger(action.page) || action.page < 1) {
        return { status: 'no-op', revision: snapshot.revision };
      }
      if (options?.isCancelled?.()) {
        return { status: 'no-op', revision: snapshot.revision };
      }

      const readingPosition = { page: action.page, location: 0 };
      try {
        if (options) {
          await projection.goToReadingPosition(document.filePath, readingPosition, options);
        } else {
          await projection.goToReadingPosition(document.filePath, readingPosition);
        }
        if (options?.isCancelled?.()) {
          return { status: 'no-op', revision: snapshot.revision };
        }
        const documents = snapshot.documents.map((item) =>
          item.filePath === document.filePath ? { ...item, readingPosition } : item,
        );
        return await commit({
          schemaVersion: 1,
          activeDocumentPath: snapshot.activeDocumentPath,
          documents,
        });
      } catch (error) {
        return { status: 'failure', error, revision: snapshot.revision };
      }
    },
    snapshot: () => snapshot,
    observe(observer) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
  };
}
