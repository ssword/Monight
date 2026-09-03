import type { ViewMode } from '../lib/document-features';
import type { FilterSettings } from '../scripts/filters';
import { createReadingSession, type PersistenceUrgency } from './reading-session';

export interface ReadingPosition {
  readonly page: number;
  readonly location: number;
}

export interface LegacyReadingPosition {
  readonly page: number;
  readonly legacyOffset: number;
}

export type RestorableReadingPosition = ReadingPosition | LegacyReadingPosition;

export type ZoomIntent =
  | { readonly kind: 'manual'; readonly scale: number }
  | { readonly kind: 'fit-width' }
  | { readonly kind: 'fit-page' };

export interface ReadingSessionVisualState {
  readonly filterSettings: Readonly<FilterSettings>;
  readonly zoomIntent: ZoomIntent;
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
  readonly schemaVersion: 2;
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
  getPageCount?(filePath: string): number | Promise<number>;
  closeDocument?(filePath: string): Promise<void>;
  exitPresentation?(): Promise<void>;
}

export interface ReaderActionOptions {
  readonly isCancelled?: () => boolean;
}

export type ReaderAction =
  | { type: 'activateDocument'; filePath: string }
  | { type: 'goToPage'; page: number; filePath?: string }
  | { type: 'goToNextPage'; filePath?: string }
  | { type: 'goToPreviousPage'; filePath?: string }
  | { type: 'settleReadingPosition'; filePath: string; readingPosition: ReadingPosition }
  | { type: 'settleVisualState'; filePath: string; visualState: ReadingSessionVisualState }
  | { type: 'registerDocument'; document: ReadingSessionDocument }
  | { type: 'removeDocument'; filePath: string };

export type ReaderActionOutcome =
  | { status: 'committed'; revision: number }
  | { status: 'no-op'; revision: number }
  | { status: 'superseded'; revision: number }
  | { status: 'failure'; error: unknown; revision: number };

interface CreateReaderActionsOptions {
  initialSession: PersistedReadingSession;
  projection: ReaderProjection;
  persist: (snapshot: ReadingSessionSnapshot) => Promise<void>;
  persistenceDebounceMs?: number;
  onObserverError?: (error: unknown) => void;
}

export interface ReaderActions {
  dispatch(action: ReaderAction, options?: ReaderActionOptions): Promise<ReaderActionOutcome>;
  snapshot(): ReadingSessionSnapshot;
  observe(observer: (snapshot: ReadingSessionSnapshot) => void): () => void;
  flush(): Promise<void>;
  hasDirtySession(): boolean;
}

interface PendingAbsoluteAction {
  superseded: boolean;
  resolve: (outcome: ReaderActionOutcome) => void;
}

type AbsoluteActionKind = 'readingPosition' | 'visualState';

interface DocumentLane {
  tail: Promise<void>;
  pendingAbsolute: Map<AbsoluteActionKind, PendingAbsoluteAction>;
  generation: number;
  pendingRemovals: number;
}

function visualStatesEqual(
  left: ReadingSessionVisualState,
  right: ReadingSessionVisualState,
): boolean {
  const filterKeys = [
    'brightness',
    'grayscale',
    'invert',
    'sepia',
    'hue',
    'extraBrightness',
  ] as const;
  return (
    left.zoomIntent.kind === right.zoomIntent.kind &&
    (left.zoomIntent.kind !== 'manual' ||
      (right.zoomIntent.kind === 'manual' && left.zoomIntent.scale === right.zoomIntent.scale)) &&
    left.rotation === right.rotation &&
    left.viewMode === right.viewMode &&
    filterKeys.every((key) => left.filterSettings[key] === right.filterSettings[key])
  );
}

export function createReaderActions({
  initialSession,
  projection,
  persist,
  persistenceDebounceMs = 250,
  onObserverError,
}: CreateReaderActionsOptions): ReaderActions {
  const session = createReadingSession({
    initialSession,
    write: persist,
    debounceMs: persistenceDebounceMs,
    onObserverError,
  });
  const lanes = new Map<string, DocumentLane>();
  let globalTail = Promise.resolve();

  const revision = (): number => session.snapshot().revision;
  const generation = (filePath: string): number => lanes.get(filePath)?.generation ?? 0;
  const isRemovalPending = (filePath: string): boolean =>
    (lanes.get(filePath)?.pendingRemovals ?? 0) > 0;
  const isDocumentOpen = (filePath: string): boolean =>
    session.snapshot().documents.some((document) => document.filePath === filePath);
  const cancelled = (
    filePath: string,
    expectedGeneration: number,
    options?: ReaderActionOptions,
  ): boolean =>
    generation(filePath) !== expectedGeneration ||
    isRemovalPending(filePath) ||
    !isDocumentOpen(filePath) ||
    Boolean(options?.isCancelled?.());

  const commit = async (
    next: PersistedReadingSession,
    urgency: PersistenceUrgency,
  ): Promise<ReaderActionOutcome> => {
    const committed = session.commit(next, urgency);
    if (urgency === 'immediate') {
      await session.flush().catch(() => undefined);
    }
    return { status: 'committed', revision: committed.revision };
  };

  const laneFor = (filePath: string): DocumentLane => {
    let lane = lanes.get(filePath);
    if (!lane) {
      lane = {
        tail: Promise.resolve(),
        pendingAbsolute: new Map(),
        generation: 0,
        pendingRemovals: 0,
      };
      lanes.set(filePath, lane);
    }
    return lane;
  };

  const enqueueAbsolute = (
    filePath: string,
    kind: AbsoluteActionKind,
    work: (expectedGeneration: number) => Promise<ReaderActionOutcome>,
  ): Promise<ReaderActionOutcome> => {
    const lane = laneFor(filePath);
    const existing = lane.pendingAbsolute.get(kind);
    if (existing) {
      existing.superseded = true;
      existing.resolve({ status: 'superseded', revision: revision() });
    }

    const expectedGeneration = generation(filePath);
    let resolveOutcome!: (outcome: ReaderActionOutcome) => void;
    const outcome = new Promise<ReaderActionOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    const pending: PendingAbsoluteAction = {
      superseded: false,
      resolve: resolveOutcome,
    };
    lane.pendingAbsolute.set(kind, pending);
    lane.tail = lane.tail
      .catch(() => undefined)
      .then(async () => {
        if (pending.superseded) return;
        if (lane.pendingAbsolute.get(kind) === pending) lane.pendingAbsolute.delete(kind);
        try {
          pending.resolve(await work(expectedGeneration));
        } catch (error) {
          pending.resolve({ status: 'failure', error, revision: revision() });
        }
      });
    return outcome;
  };

  const enqueueRelative = (
    filePath: string,
    work: (expectedGeneration: number) => Promise<ReaderActionOutcome>,
  ): Promise<ReaderActionOutcome> => {
    const lane = laneFor(filePath);
    const expectedGeneration = generation(filePath);
    const outcome = lane.tail
      .catch(() => undefined)
      .then(() => work(expectedGeneration))
      .catch((error): ReaderActionOutcome => ({ status: 'failure', error, revision: revision() }));
    lane.tail = outcome.then(() => undefined);
    return outcome;
  };

  const enqueueGlobal = (
    work: () => Promise<ReaderActionOutcome>,
  ): Promise<ReaderActionOutcome> => {
    const outcome = globalTail.catch(() => undefined).then(work);
    globalTail = outcome.then(
      () => undefined,
      () => undefined,
    );
    return outcome;
  };

  const routeDocumentAction = (
    requestedPath: string | undefined,
    enqueue: (filePath: string) => Promise<ReaderActionOutcome>,
  ): Promise<ReaderActionOutcome> => {
    const precedingGlobal = globalTail;
    return precedingGlobal
      .catch(() => undefined)
      .then(() => {
        const filePath = requestedPath ?? session.snapshot().activeDocumentPath;
        return filePath ? enqueue(filePath) : { status: 'no-op' as const, revision: revision() };
      })
      .catch((error): ReaderActionOutcome => ({ status: 'failure', error, revision: revision() }));
  };

  const enqueueSettledUpdate = (
    filePath: string,
    kind: AbsoluteActionKind,
    options: ReaderActionOptions | undefined,
    update: (document: ReadingSessionDocument) => ReadingSessionDocument | null,
  ): Promise<ReaderActionOutcome> =>
    routeDocumentAction(filePath, (routedPath) =>
      enqueueAbsolute(routedPath, kind, async (expectedGeneration) => {
        if (cancelled(routedPath, expectedGeneration, options)) {
          return { status: 'no-op', revision: revision() };
        }
        const current = session.snapshot();
        const document = current.documents.find((item) => item.filePath === routedPath);
        if (!document) return { status: 'no-op', revision: current.revision };
        const updated = update(document);
        if (!updated) return { status: 'no-op', revision: current.revision };
        const documents = current.documents.map((item) =>
          item.filePath === routedPath ? updated : item,
        );
        return commit(
          { schemaVersion: 2, activeDocumentPath: current.activeDocumentPath, documents },
          'deferred',
        );
      }),
    );

  return {
    async dispatch(action, options) {
      if (action.type === 'removeDocument') {
        const lane = laneFor(action.filePath);
        lane.pendingRemovals += 1;
        lane.generation += 1;
        for (const pending of lane.pendingAbsolute.values()) {
          pending.superseded = true;
          pending.resolve({ status: 'no-op', revision: revision() });
        }
        lane.pendingAbsolute.clear();

        return enqueueGlobal(async () => {
          try {
            const current = session.snapshot();
            const index = current.documents.findIndex((item) => item.filePath === action.filePath);
            if (index === -1) return { status: 'no-op', revision: current.revision };
            try {
              await projection.exitPresentation?.();
              await projection.closeDocument?.(action.filePath);
            } catch (error) {
              return { status: 'failure', error, revision: revision() };
            }
            const latest = session.snapshot();
            const latestIndex = latest.documents.findIndex(
              (item) => item.filePath === action.filePath,
            );
            if (latestIndex === -1) return { status: 'no-op', revision: latest.revision };
            const documents = latest.documents.filter((item) => item.filePath !== action.filePath);
            const activeDocumentPath =
              latest.activeDocumentPath === action.filePath
                ? (documents[Math.min(latestIndex, documents.length - 1)]?.filePath ?? null)
                : latest.activeDocumentPath;
            return commit({ schemaVersion: 2, activeDocumentPath, documents }, 'immediate');
          } finally {
            lane.pendingRemovals -= 1;
          }
        });
      }

      if (action.type === 'registerDocument') {
        return enqueueGlobal(async () => {
          const current = session.snapshot();
          if (current.documents.some((item) => item.filePath === action.document.filePath)) {
            return { status: 'no-op', revision: current.revision };
          }
          laneFor(action.document.filePath);
          return commit(
            {
              schemaVersion: 2,
              activeDocumentPath: current.activeDocumentPath,
              documents: [...current.documents, action.document],
            },
            'immediate',
          );
        });
      }

      if (action.type === 'activateDocument') {
        return enqueueGlobal(async () => {
          const current = session.snapshot();
          const document = current.documents.find((item) => item.filePath === action.filePath);
          if (!document) return { status: 'no-op', revision: current.revision };
          try {
            await projection.exitPresentation?.();
            await projection.activateDocument(document.filePath, document.readingPosition);
          } catch (error) {
            return { status: 'failure', error, revision: revision() };
          }
          const latest = session.snapshot();
          if (!latest.documents.some((item) => item.filePath === document.filePath)) {
            return { status: 'no-op', revision: latest.revision };
          }
          if (latest.activeDocumentPath === document.filePath) {
            return { status: 'no-op', revision: latest.revision };
          }
          return commit(
            {
              schemaVersion: 2,
              activeDocumentPath: document.filePath,
              documents: latest.documents,
            },
            'immediate',
          );
        });
      }

      if (action.type === 'settleReadingPosition') {
        const { page, location } = action.readingPosition;
        if (
          !Number.isInteger(page) ||
          page < 1 ||
          !Number.isFinite(location) ||
          location < 0 ||
          location > 1
        ) {
          return { status: 'no-op', revision: revision() };
        }

        return enqueueSettledUpdate(action.filePath, 'readingPosition', options, (document) => {
          if (
            'location' in document.readingPosition &&
            document.readingPosition.page === page &&
            document.readingPosition.location === location
          ) {
            return null;
          }
          return { ...document, readingPosition: { page, location } };
        });
      }

      if (action.type === 'settleVisualState') {
        const visualState = action.visualState;
        if (
          (visualState.zoomIntent.kind === 'manual' &&
            (!Number.isFinite(visualState.zoomIntent.scale) ||
              visualState.zoomIntent.scale <= 0)) ||
          !Number.isFinite(visualState.rotation)
        ) {
          return { status: 'no-op', revision: revision() };
        }

        return enqueueSettledUpdate(action.filePath, 'visualState', options, (document) => {
          if (document.visualState && visualStatesEqual(document.visualState, visualState)) {
            return null;
          }
          return {
            ...document,
            visualState: {
              ...visualState,
              filterSettings: { ...visualState.filterSettings },
            },
          };
        });
      }

      if (action.type === 'goToNextPage' || action.type === 'goToPreviousPage') {
        return routeDocumentAction(action.filePath, (filePath) =>
          enqueueRelative(filePath, async (expectedGeneration) => {
            if (cancelled(filePath, expectedGeneration, options)) {
              return { status: 'no-op', revision: revision() };
            }
            const current = session.snapshot();
            const document = current.documents.find((item) => item.filePath === filePath);
            if (!document) return { status: 'no-op', revision: current.revision };
            const reportedPageCount = await projection.getPageCount?.(filePath);
            if (cancelled(filePath, expectedGeneration, options)) {
              return { status: 'no-op', revision: revision() };
            }
            const totalPages =
              reportedPageCount === undefined
                ? Number.MAX_SAFE_INTEGER
                : Math.max(1, reportedPageCount);
            const step = document.visualState?.viewMode === 'spread' ? 2 : 1;
            const direction = action.type === 'goToNextPage' ? 1 : -1;
            const page = Math.min(
              Math.max(document.readingPosition.page + direction * step, 1),
              totalPages,
            );
            if (page === document.readingPosition.page) {
              return { status: 'no-op', revision: current.revision };
            }
            const readingPosition = { page, location: 0 };
            try {
              await projection.goToReadingPosition(filePath, readingPosition, {
                isCancelled: () => cancelled(filePath, expectedGeneration, options),
              });
            } catch (error) {
              if (cancelled(filePath, expectedGeneration, options)) {
                return { status: 'no-op', revision: revision() };
              }
              return { status: 'failure', error, revision: revision() };
            }
            if (cancelled(filePath, expectedGeneration, options)) {
              return { status: 'no-op', revision: revision() };
            }
            const latest = session.snapshot();
            const documents = latest.documents.map((item) =>
              item.filePath === filePath ? { ...item, readingPosition } : item,
            );
            return commit(
              { schemaVersion: 2, activeDocumentPath: latest.activeDocumentPath, documents },
              'deferred',
            );
          }),
        );
      }

      if (!Number.isInteger(action.page) || action.page < 1) {
        return { status: 'no-op', revision: revision() };
      }

      return routeDocumentAction(action.filePath, (filePath) =>
        enqueueAbsolute(filePath, 'readingPosition', async (expectedGeneration) => {
          if (cancelled(filePath, expectedGeneration, options)) {
            return { status: 'no-op', revision: revision() };
          }
          const readingPosition = { page: action.page, location: 0 };
          try {
            if (options) {
              await projection.goToReadingPosition(filePath, readingPosition, {
                isCancelled: () => cancelled(filePath, expectedGeneration, options),
              });
            } else {
              await projection.goToReadingPosition(filePath, readingPosition);
            }
          } catch (error) {
            if (cancelled(filePath, expectedGeneration, options)) {
              return { status: 'no-op', revision: revision() };
            }
            return { status: 'failure', error, revision: revision() };
          }
          if (cancelled(filePath, expectedGeneration, options)) {
            return { status: 'no-op', revision: revision() };
          }
          const latest = session.snapshot();
          const documents = latest.documents.map((item) =>
            item.filePath === filePath ? { ...item, readingPosition } : item,
          );
          return commit(
            { schemaVersion: 2, activeDocumentPath: latest.activeDocumentPath, documents },
            'deferred',
          );
        }),
      );
    },
    snapshot: session.snapshot,
    observe: session.observe,
    flush: session.flush,
    hasDirtySession: session.isDirty,
  };
}
