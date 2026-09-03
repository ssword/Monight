import type {
  PersistedReadingSession,
  ReadingSessionDocument,
  ReadingSessionSnapshot,
} from './reader-actions';

export type PersistenceUrgency = 'deferred' | 'immediate';

interface ReadingSessionOptions {
  initialSession: PersistedReadingSession;
  write: (snapshot: ReadingSessionSnapshot) => Promise<void>;
  debounceMs?: number;
  onObserverError?: (error: unknown) => void;
}

export interface ReadingSession {
  snapshot(): ReadingSessionSnapshot;
  observe(observer: (snapshot: ReadingSessionSnapshot) => void): () => void;
  commit(session: PersistedReadingSession, urgency: PersistenceUrgency): ReadingSessionSnapshot;
  flush(): Promise<void>;
  isDirty(): boolean;
}

function freezeDocument(document: ReadingSessionDocument): ReadingSessionDocument {
  return Object.freeze({
    ...document,
    readingPosition: Object.freeze({ ...document.readingPosition }),
    visualState: document.visualState
      ? Object.freeze({
          rotation: document.visualState.rotation,
          viewMode: document.visualState.viewMode,
          zoomIntent: Object.freeze({ ...document.visualState.zoomIntent }),
          filterSettings: Object.freeze({ ...document.visualState.filterSettings }),
        })
      : undefined,
  });
}

function freezeSnapshot(
  session: PersistedReadingSession,
  revision: number,
): ReadingSessionSnapshot {
  return Object.freeze({
    ...session,
    revision,
    documents: Object.freeze(session.documents.map(freezeDocument)),
  });
}

export function createReadingSession({
  initialSession,
  write,
  debounceMs = 250,
  onObserverError = (error) => console.error('Reading Session observer failed:', error),
}: ReadingSessionOptions): ReadingSession {
  let current = freezeSnapshot(initialSession, 0);
  let persistedRevision = 0;
  let persistence: Promise<void> | null = null;
  let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
  const observers = new Set<(snapshot: ReadingSessionSnapshot) => void>();

  const clearPersistenceTimer = (): void => {
    if (persistenceTimer === null) return;
    clearTimeout(persistenceTimer);
    persistenceTimer = null;
  };

  const persistDirtySnapshots = (): Promise<void> => {
    if (persistence) return persistence;

    const running = (async () => {
      while (persistedRevision < current.revision) {
        const target = current;
        await write(target);
        persistedRevision = target.revision;
      }
    })();
    persistence = running;
    void running.then(
      () => {
        if (persistence === running) persistence = null;
      },
      () => {
        if (persistence === running) persistence = null;
      },
    );
    return running;
  };

  const requestPersistence = (urgency: PersistenceUrgency): void => {
    if (urgency === 'immediate') {
      clearPersistenceTimer();
      void persistDirtySnapshots().catch(() => undefined);
      return;
    }

    clearPersistenceTimer();
    persistenceTimer = setTimeout(() => {
      persistenceTimer = null;
      void persistDirtySnapshots().catch(() => undefined);
    }, debounceMs);
  };

  return {
    snapshot: () => current,
    observe(observer) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    commit(session, urgency) {
      current = freezeSnapshot(session, current.revision + 1);
      for (const observer of observers) {
        try {
          observer(current);
        } catch (error) {
          onObserverError(error);
        }
      }
      requestPersistence(urgency);
      return current;
    },
    async flush() {
      clearPersistenceTimer();
      while (persistedRevision < current.revision) {
        await persistDirtySnapshots();
      }
    },
    isDirty: () => persistedRevision < current.revision,
  };
}
