import type { ViewMode } from '../lib/document-features';
import { type FilterSettings, PRESETS } from '../scripts/filters';
import {
  createReadingSession,
  type DocumentPathReconciliation,
  type PersistenceUrgency,
} from './reading-session';

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
  activateDocument(
    filePath: string,
    position: RestorableReadingPosition,
    visualState?: ReadingSessionVisualState,
  ): Promise<void>;
  goToReadingPosition(
    filePath: string,
    position: RestorableReadingPosition,
    options?: ReaderActionOptions,
  ): Promise<void>;
  getPageCount?(filePath: string): number | Promise<number>;
  closeDocument?(filePath: string): Promise<void>;
  exitPresentation?(): Promise<void>;
  applyZoomIntent?(
    filePath: string,
    zoomIntent: ZoomIntent,
    options?: ReaderActionOptions,
  ): Promise<ZoomIntent>;
  applyRelativeZoom?(
    filePath: string,
    direction: 'in' | 'out',
    options?: ReaderActionOptions,
  ): Promise<ZoomIntent>;
  applyRotation?(filePath: string, rotation: number, options?: ReaderActionOptions): Promise<void>;
  applyViewMode?(
    filePath: string,
    viewMode: ViewMode,
    options?: ReaderActionOptions,
  ): Promise<void>;
  applyFilterSettings?(
    filePath: string,
    filterSettings: Readonly<FilterSettings>,
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
      readingPosition?: RestorableReadingPosition;
    }
  | { type: 'goToPage'; page: number; filePath?: string }
  | { type: 'goToNextPage'; filePath?: string }
  | { type: 'goToPreviousPage'; filePath?: string }
  | { type: 'settleReadingPosition'; filePath: string; readingPosition: ReadingPosition }
  | { type: 'setZoomIntent'; zoomIntent: ZoomIntent; filePath?: string }
  | { type: 'zoomIn'; filePath?: string }
  | { type: 'zoomOut'; filePath?: string }
  | { type: 'rotateClockwise'; filePath?: string }
  | { type: 'rotateCounterClockwise'; filePath?: string }
  | { type: 'setViewMode'; viewMode: ViewMode; filePath?: string }
  | { type: 'cycleViewMode'; filePath?: string }
  | { type: 'setFilterSettings'; filterSettings: FilterSettings; filePath?: string }
  | { type: 'registerDocument'; document: ReadingSessionDocument }
  | { type: 'removeDocument'; filePath: string };

const withOptionalFilePath = <T extends { type: ReaderAction['type'] }>(
  action: T,
  filePath?: string,
): T & { filePath?: string } => (filePath ? { ...action, filePath } : action);

export const readerAction = {
  zoomIn: (filePath?: string): ReaderAction => withOptionalFilePath({ type: 'zoomIn' }, filePath),
  zoomOut: (filePath?: string): ReaderAction => withOptionalFilePath({ type: 'zoomOut' }, filePath),
  setZoomIntent: (zoomIntent: ZoomIntent, filePath?: string): ReaderAction =>
    withOptionalFilePath({ type: 'setZoomIntent', zoomIntent }, filePath),
  rotateClockwise: (filePath?: string): ReaderAction =>
    withOptionalFilePath({ type: 'rotateClockwise' }, filePath),
  rotateCounterClockwise: (filePath?: string): ReaderAction =>
    withOptionalFilePath({ type: 'rotateCounterClockwise' }, filePath),
  cycleViewMode: (filePath?: string): ReaderAction =>
    withOptionalFilePath({ type: 'cycleViewMode' }, filePath),
  setViewMode: (viewMode: ViewMode, filePath?: string): ReaderAction =>
    withOptionalFilePath({ type: 'setViewMode', viewMode }, filePath),
  setFilterSettings: (filterSettings: FilterSettings, filePath?: string): ReaderAction =>
    withOptionalFilePath({ type: 'setFilterSettings', filterSettings }, filePath),
};

export type DispatchReaderAction = (action: ReaderAction) => Promise<void>;

export type ReaderActionOutcome =
  | { status: 'committed'; revision: number }
  | { status: 'no-op'; revision: number }
  | { status: 'superseded'; revision: number }
  | { status: 'failure'; error: unknown; revision: number };

interface CreateReaderActionsOptions {
  initialSession: PersistedReadingSession;
  defaultVisualState?: ReadingSessionVisualState;
  projection: ReaderProjection;
  persist: (snapshot: ReadingSessionSnapshot) => Promise<void>;
  persistenceDebounceMs?: number;
  onObserverError?: (error: unknown) => void;
}

export interface ReaderActions {
  dispatch(action: ReaderAction, options?: ReaderActionOptions): Promise<ReaderActionOutcome>;
  canonicalizeDocumentPaths(
    paths: readonly DocumentPathReconciliation[],
  ): Promise<ReaderActionOutcome>;
  snapshot(): ReadingSessionSnapshot;
  observe(observer: (snapshot: ReadingSessionSnapshot) => void): () => void;
  flush(): Promise<void>;
  hasDirtySession(): boolean;
}

interface PendingAbsoluteAction {
  superseded: boolean;
  resolve: (outcome: ReaderActionOutcome) => void;
}

type AbsoluteActionKind = 'readingPosition' | 'zoomIntent' | 'viewMode' | 'filterSettings';

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

function createDefaultVisualState(): ReadingSessionVisualState {
  return {
    filterSettings: { ...PRESETS.default },
    zoomIntent: { kind: 'manual', scale: 1 },
    rotation: 0,
    viewMode: 'single',
  };
}

function validZoomIntent(zoomIntent: ZoomIntent): boolean {
  return (
    zoomIntent.kind !== 'manual' || (Number.isFinite(zoomIntent.scale) && zoomIntent.scale > 0)
  );
}

function validFilterSettings(filterSettings: Readonly<FilterSettings>): boolean {
  return Object.values(filterSettings).every(Number.isFinite);
}

function validReadingPosition(readingPosition: RestorableReadingPosition): boolean {
  if (!Number.isInteger(readingPosition.page) || readingPosition.page < 1) return false;
  if ('location' in readingPosition) {
    return (
      Number.isFinite(readingPosition.location) &&
      readingPosition.location >= 0 &&
      readingPosition.location <= 1
    );
  }
  return Number.isFinite(readingPosition.legacyOffset) && readingPosition.legacyOffset >= 0;
}

function readingPositionsEqual(
  left: RestorableReadingPosition,
  right: RestorableReadingPosition,
): boolean {
  if (left.page !== right.page) return false;
  if ('location' in left && 'location' in right) return left.location === right.location;
  if ('legacyOffset' in left && 'legacyOffset' in right) {
    return left.legacyOffset === right.legacyOffset;
  }
  return false;
}

function filterSettingsEqual(
  left: Readonly<FilterSettings>,
  right: Readonly<FilterSettings>,
): boolean {
  return (Object.keys(left) as Array<keyof FilterSettings>).every(
    (key) => left[key] === right[key],
  );
}

function normalizeRotation(rotation: number): number {
  return (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
}

function nextViewMode(viewMode: ViewMode): ViewMode {
  switch (viewMode) {
    case 'single':
      return 'continuous';
    case 'continuous':
      return 'spread';
    case 'spread':
      return 'single';
  }
}

export function createReaderActions({
  initialSession,
  defaultVisualState = createDefaultVisualState(),
  projection,
  persist,
  persistenceDebounceMs = 250,
  onObserverError,
}: CreateReaderActionsOptions): ReaderActions {
  const normalizedInitialSession: PersistedReadingSession = {
    ...initialSession,
    documents: initialSession.documents.map((document) => ({
      ...document,
      visualState: document.visualState ?? {
        ...defaultVisualState,
        zoomIntent: { ...defaultVisualState.zoomIntent },
        filterSettings: { ...defaultVisualState.filterSettings },
      },
    })),
  };
  const session = createReadingSession({
    initialSession: normalizedInitialSession,
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

  const commitVisualState = async (
    filePath: string,
    visualState: ReadingSessionVisualState,
  ): Promise<ReaderActionOutcome> => {
    const latest = session.snapshot();
    const document = latest.documents.find((item) => item.filePath === filePath);
    if (!document) return { status: 'no-op', revision: latest.revision };
    if (document.visualState && visualStatesEqual(document.visualState, visualState)) {
      return { status: 'no-op', revision: latest.revision };
    }
    const documents = latest.documents.map((item) =>
      item.filePath === filePath
        ? {
            ...item,
            visualState: {
              ...visualState,
              zoomIntent: { ...visualState.zoomIntent },
              filterSettings: { ...visualState.filterSettings },
            },
          }
        : item,
    );
    return commit(
      { schemaVersion: 2, activeDocumentPath: latest.activeDocumentPath, documents },
      'deferred',
    );
  };

  const projectVisualState = async (
    filePath: string,
    expectedGeneration: number,
    options: ReaderActionOptions | undefined,
    project: (current: ReadingSessionVisualState) => Promise<ReadingSessionVisualState | null>,
  ): Promise<ReaderActionOutcome> => {
    if (cancelled(filePath, expectedGeneration, options)) {
      return { status: 'no-op', revision: revision() };
    }
    const document = session.snapshot().documents.find((item) => item.filePath === filePath);
    if (!document) return { status: 'no-op', revision: revision() };

    let visualState: ReadingSessionVisualState | null;
    try {
      visualState = await project(document.visualState ?? createDefaultVisualState());
    } catch (error) {
      return { status: 'failure', error, revision: revision() };
    }
    if (!visualState || cancelled(filePath, expectedGeneration, options)) {
      return { status: 'no-op', revision: revision() };
    }
    return commitVisualState(filePath, visualState);
  };

  const canonicalizeDocumentPaths = (
    paths: readonly DocumentPathReconciliation[],
  ): Promise<ReaderActionOutcome> =>
    enqueueGlobal(async () => {
      const canonicalByRequestedPath = new Map(
        paths.map(({ requestedPath, canonicalPath }) => [requestedPath, canonicalPath]),
      );
      const current = session.snapshot();
      const preferredDocumentByCanonicalPath = new Map<string, ReadingSessionDocument>();
      for (const { requestedPath, canonicalPath, runtimeStateSource } of paths) {
        if (
          runtimeStateSource !== 'requested' ||
          preferredDocumentByCanonicalPath.has(canonicalPath)
        ) {
          continue;
        }
        const document = current.documents.find((item) => item.filePath === requestedPath);
        if (document) preferredDocumentByCanonicalPath.set(canonicalPath, document);
      }
      for (const document of current.documents) {
        const canonicalPath = canonicalByRequestedPath.get(document.filePath) ?? document.filePath;
        if (
          document.filePath === canonicalPath &&
          !preferredDocumentByCanonicalPath.has(canonicalPath)
        ) {
          preferredDocumentByCanonicalPath.set(canonicalPath, document);
        }
      }
      for (const { requestedPath, canonicalPath } of paths) {
        if (preferredDocumentByCanonicalPath.has(canonicalPath)) continue;
        const document = current.documents.find((item) => item.filePath === requestedPath);
        if (document) preferredDocumentByCanonicalPath.set(canonicalPath, document);
      }
      const seen = new Set<string>();
      let changed = false;
      const documents: ReadingSessionDocument[] = [];

      for (const document of current.documents) {
        const filePath = canonicalByRequestedPath.get(document.filePath) ?? document.filePath;
        if (filePath !== document.filePath) changed = true;
        if (seen.has(filePath)) {
          changed = true;
          continue;
        }
        seen.add(filePath);
        const preferredDocument = preferredDocumentByCanonicalPath.get(filePath) ?? document;
        documents.push(
          preferredDocument.filePath === filePath
            ? preferredDocument
            : { ...preferredDocument, filePath },
        );
        laneFor(filePath);
      }

      const activeDocumentPath = current.activeDocumentPath
        ? (canonicalByRequestedPath.get(current.activeDocumentPath) ?? current.activeDocumentPath)
        : null;
      if (activeDocumentPath !== current.activeDocumentPath) changed = true;
      if (!changed) return { status: 'no-op', revision: current.revision };

      return commit({ schemaVersion: 2, activeDocumentPath, documents }, 'immediate');
    });

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
        if (action.readingPosition && !validReadingPosition(action.readingPosition)) {
          return { status: 'no-op', revision: revision() };
        }
        return enqueueGlobal(async () => {
          const current = session.snapshot();
          const document = current.documents.find((item) => item.filePath === action.filePath);
          if (!document) return { status: 'no-op', revision: current.revision };
          const readingPosition = action.readingPosition ?? document.readingPosition;
          try {
            await projection.exitPresentation?.();
            await projection.activateDocument(
              document.filePath,
              readingPosition,
              document.visualState,
            );
          } catch (error) {
            return { status: 'failure', error, revision: revision() };
          }
          const latest = session.snapshot();
          const latestDocument = latest.documents.find(
            (item) => item.filePath === document.filePath,
          );
          if (!latestDocument) {
            return { status: 'no-op', revision: latest.revision };
          }
          const readingPositionChanged = !readingPositionsEqual(
            latestDocument.readingPosition,
            readingPosition,
          );
          if (latest.activeDocumentPath === document.filePath && !readingPositionChanged) {
            return { status: 'no-op', revision: latest.revision };
          }
          const documents = readingPositionChanged
            ? latest.documents.map((item) =>
                item.filePath === document.filePath ? { ...item, readingPosition } : item,
              )
            : latest.documents;
          return commit(
            {
              schemaVersion: 2,
              activeDocumentPath: document.filePath,
              documents,
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

      if (action.type === 'setZoomIntent') {
        if (!validZoomIntent(action.zoomIntent)) {
          return { status: 'no-op', revision: revision() };
        }

        return routeDocumentAction(action.filePath, (filePath) =>
          enqueueAbsolute(filePath, 'zoomIntent', (expectedGeneration) =>
            projectVisualState(filePath, expectedGeneration, options, async (current) => {
              if (
                action.zoomIntent.kind === 'manual' &&
                current.zoomIntent.kind === 'manual' &&
                current.zoomIntent.scale === action.zoomIntent.scale
              ) {
                return null;
              }
              if (!projection.applyZoomIntent) {
                throw new Error('Reader projection cannot apply Zoom Intent');
              }
              const zoomIntent = await projection.applyZoomIntent(
                filePath,
                action.zoomIntent,
                options,
              );
              return validZoomIntent(zoomIntent) ? { ...current, zoomIntent } : null;
            }),
          ),
        );
      }

      if (action.type === 'zoomIn' || action.type === 'zoomOut') {
        return routeDocumentAction(action.filePath, (filePath) =>
          enqueueRelative(filePath, (expectedGeneration) =>
            projectVisualState(filePath, expectedGeneration, options, async (current) => {
              if (!projection.applyRelativeZoom) {
                throw new Error('Reader projection cannot apply relative zoom');
              }
              const zoomIntent = await projection.applyRelativeZoom(
                filePath,
                action.type === 'zoomIn' ? 'in' : 'out',
                options,
              );
              return validZoomIntent(zoomIntent) ? { ...current, zoomIntent } : null;
            }),
          ),
        );
      }

      if (action.type === 'rotateClockwise' || action.type === 'rotateCounterClockwise') {
        return routeDocumentAction(action.filePath, (filePath) =>
          enqueueRelative(filePath, (expectedGeneration) =>
            projectVisualState(filePath, expectedGeneration, options, async (current) => {
              const rotation = normalizeRotation(
                current.rotation + (action.type === 'rotateClockwise' ? 90 : -90),
              );
              if (!projection.applyRotation) {
                throw new Error('Reader projection cannot apply rotation');
              }
              await projection.applyRotation(filePath, rotation, options);
              return { ...current, rotation };
            }),
          ),
        );
      }

      if (action.type === 'setViewMode') {
        return routeDocumentAction(action.filePath, (filePath) =>
          enqueueAbsolute(filePath, 'viewMode', (expectedGeneration) =>
            projectVisualState(filePath, expectedGeneration, options, async (current) => {
              if (current.viewMode === action.viewMode) return null;
              if (!projection.applyViewMode) {
                throw new Error('Reader projection cannot apply view mode');
              }
              await projection.applyViewMode(filePath, action.viewMode, options);
              return { ...current, viewMode: action.viewMode };
            }),
          ),
        );
      }

      if (action.type === 'cycleViewMode') {
        return routeDocumentAction(action.filePath, (filePath) =>
          enqueueRelative(filePath, (expectedGeneration) =>
            projectVisualState(filePath, expectedGeneration, options, async (current) => {
              const viewMode = nextViewMode(current.viewMode);
              if (!projection.applyViewMode) {
                throw new Error('Reader projection cannot apply view mode');
              }
              await projection.applyViewMode(filePath, viewMode, options);
              return { ...current, viewMode };
            }),
          ),
        );
      }

      if (action.type === 'setFilterSettings') {
        if (!validFilterSettings(action.filterSettings)) {
          return { status: 'no-op', revision: revision() };
        }
        return routeDocumentAction(action.filePath, (filePath) =>
          enqueueAbsolute(filePath, 'filterSettings', (expectedGeneration) =>
            projectVisualState(filePath, expectedGeneration, options, async (current) => {
              if (filterSettingsEqual(current.filterSettings, action.filterSettings)) return null;
              if (!projection.applyFilterSettings) {
                throw new Error('Reader projection cannot apply filter settings');
              }
              await projection.applyFilterSettings(filePath, action.filterSettings, options);
              return { ...current, filterSettings: { ...action.filterSettings } };
            }),
          ),
        );
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
    canonicalizeDocumentPaths,
    snapshot: session.snapshot,
    observe: session.observe,
    flush: session.flush,
    hasDirtySession: session.isDirty,
  };
}
