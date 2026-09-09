import type { ViewMode } from '../lib/document-features';
import type { PdfLinkTarget } from '../lib/pdf-links';
import { type FilterSettings, PRESETS } from '../scripts/filters';
import { createDocumentQuery, type DocumentQuery, type DocumentRuntime } from './document-queries';
import type { NativePdfSaveAdapter, PdfSaveDestination } from './native-pdf-editing';
import {
  createReadingSession,
  type DocumentPathReconciliation,
  type PersistenceUrgency,
} from './reading-session';
import type { RecoveryDraftAdapter } from './recovery-drafts';

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

export interface PresentationExitOptions {
  readonly restoreVisualState?: boolean;
}

export type RestorePresentation = () => Promise<void>;

export interface ReaderProjection {
  prepareReloadDocument?(
    document: ReadingSessionDocument,
    options: ReaderActionOptions,
  ): Promise<{
    runtime: DocumentRuntime;
    commit(): void;
    dispose(): Promise<void>;
  }>;
  verifySavedDocument?(
    document: ReadingSessionDocument,
    bytes: Uint8Array,
    options: ReaderActionOptions,
  ): Promise<void>;
  reidentifyDocument?(filePath: string, destination: PdfSaveDestination): void;
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
  closeDocument?(filePath: string, nextActiveDocumentPath: string | null): Promise<void>;
  exitPresentation?(options?: PresentationExitOptions): Promise<RestorePresentation | undefined>;
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
  | {
      type: 'registerDocument';
      document: ReadingSessionDocument;
      runtime: DocumentRuntime;
      activate?: boolean;
      readingPosition?: RestorableReadingPosition;
    }
  | { type: 'activateDocumentTarget'; filePath: string; target: PdfLinkTarget }
  | { type: 'printDocument'; filePath?: string }
  | { type: 'discardAndReloadDocument'; filePath?: string }
  | { type: 'saveDocument'; filePath?: string }
  | { type: 'saveDocumentAs'; filePath?: string }
  | { type: 'reorderDocuments'; filePaths: readonly string[] }
  | { type: 'closeDocument'; filePath: string }
  | { type: 'reopenLastClosedDocument' }
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
  | { status: 'performed'; revision: number }
  | { status: 'no-op'; revision: number }
  | { status: 'superseded'; revision: number }
  | { status: 'failure'; error: unknown; revision: number };

export interface ExternalLinkAdapter {
  open(url: string): Promise<void>;
}

export interface PrintDocumentRequest {
  readonly filePath: string;
  readonly title: string;
  readonly bytes: Uint8Array;
}

export interface PrintAdapter {
  print(request: PrintDocumentRequest): Promise<void>;
}

export type UnsavedDocumentChoice = 'save' | 'save-as' | 'discard' | 'cancel';

export interface UnsavedDocumentRequest {
  readonly filePath: string;
  readonly title: string;
  readonly error?: unknown;
}

interface CreateReaderActionsOptions {
  chooseUnsavedDocument?: (request: UnsavedDocumentRequest) => Promise<UnsavedDocumentChoice>;
  initialSession: PersistedReadingSession;
  defaultVisualState?: ReadingSessionVisualState;
  projection: ReaderProjection;
  externalLinkAdapter?: ExternalLinkAdapter;
  printAdapter?: PrintAdapter;
  pdfSaveAdapter?: NativePdfSaveAdapter;
  recoveryDraftAdapter?: RecoveryDraftAdapter;
  reopenDocument?: (filePath: string) => Promise<void>;
  persist: (snapshot: ReadingSessionSnapshot) => Promise<void>;
  persistenceDebounceMs?: number;
  onObserverError?: (error: unknown) => void;
}

export interface ReaderActions {
  dispatch(action: ReaderAction, options?: ReaderActionOptions): Promise<ReaderActionOutcome>;
  canonicalizeDocumentPaths(
    paths: readonly DocumentPathReconciliation[],
  ): Promise<ReaderActionOutcome>;
  query(filePath?: string): DocumentQuery | null;
  isDocumentOpen(filePath: string): boolean;
  snapshot(): ReadingSessionSnapshot;
  observe(observer: (snapshot: ReadingSessionSnapshot) => void): () => void;
  quiesce(): Promise<void>;
  flush(): Promise<void>;
  captureRecoveryDraft(filePath: string): Promise<ReaderActionOutcome>;
  hasDirtySession(): boolean;
  hasUnsavedPdfWork(): boolean;
  prepareShutdown(): Promise<boolean>;
  isShutdownPrepared(): boolean;
  cancelShutdown(): void;
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

interface GlobalLaneReservation {
  readonly filePath: string;
  tail: Promise<void>;
}

interface RegisteredDocumentRuntime {
  generation: number;
  readonly runtime: DocumentRuntime;
}

type DocumentContentOperationResult<T> =
  | { readonly status: 'ready'; readonly value: T }
  | Extract<ReaderActionOutcome, { status: 'no-op' | 'failure' }>;

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

function closeDocumentTransition(
  session: PersistedReadingSession,
  filePath: string,
): Pick<PersistedReadingSession, 'activeDocumentPath' | 'documents'> | null {
  const index = session.documents.findIndex((document) => document.filePath === filePath);
  if (index === -1) return null;
  const documents = session.documents.filter((document) => document.filePath !== filePath);
  const activeDocumentPath =
    session.activeDocumentPath === filePath
      ? (documents[Math.min(index, documents.length - 1)]?.filePath ?? null)
      : session.activeDocumentPath;
  return { activeDocumentPath, documents };
}

function activateDocumentTransition(
  session: PersistedReadingSession,
  document: ReadingSessionDocument,
  readingPosition: RestorableReadingPosition,
): PersistedReadingSession | null {
  const readingPositionChanged = !readingPositionsEqual(document.readingPosition, readingPosition);
  if (session.activeDocumentPath === document.filePath && !readingPositionChanged) return null;
  const documents = readingPositionChanged
    ? session.documents.map((item) =>
        item.filePath === document.filePath ? { ...item, readingPosition } : item,
      )
    : session.documents;
  return {
    schemaVersion: 2,
    activeDocumentPath: document.filePath,
    documents,
  };
}

export function createReaderActions({
  initialSession,
  defaultVisualState = createDefaultVisualState(),
  projection,
  externalLinkAdapter,
  printAdapter,
  pdfSaveAdapter,
  recoveryDraftAdapter,
  chooseUnsavedDocument,
  reopenDocument,
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
  const runtimes = new Map<string, RegisteredDocumentRuntime>();
  const runtimeGenerations = new Map<string, number>();
  const pendingSaves = new Map<string, Promise<ReaderActionOutcome>>();
  const pendingDraftCaptures = new Map<DocumentRuntime, Promise<ReaderActionOutcome>>();
  const pendingReloads = new Set<string>();
  const recentlyClosedDocumentPaths: string[] = [];
  let globalTail = Promise.resolve();
  let recoveryTail = Promise.resolve();
  let activeReopenReservation: GlobalLaneReservation | null = null;

  const enqueueRecovery = <T>(work: () => Promise<T>): Promise<T> => {
    const result = recoveryTail.catch(() => undefined).then(work);
    recoveryTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const exportTails = new WeakMap<DocumentRuntime, Promise<void>>();
  const exportPdf = (
    runtime: DocumentRuntime,
    editing: NonNullable<DocumentRuntime['editing']>,
  ): Promise<Uint8Array> => {
    const result = (exportTails.get(runtime) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => editing.exportPdf());
    exportTails.set(
      runtime,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  };

  const revision = (): number => session.snapshot().revision;
  const generation = (filePath: string): number => lanes.get(filePath)?.generation ?? 0;
  const isRemovalPending = (filePath: string): boolean =>
    (lanes.get(filePath)?.pendingRemovals ?? 0) > 0;
  const hasSessionDocument = (filePath: string): boolean =>
    session.snapshot().documents.some((document) => document.filePath === filePath);
  const invalidateRuntime = (filePath: string): RegisteredDocumentRuntime | undefined => {
    const registered = runtimes.get(filePath);
    if (!registered) return undefined;
    runtimeGenerations.set(filePath, registered.generation + 1);
    return registered;
  };
  const removeRuntime = async (filePath: string): Promise<void> => {
    const registered = runtimes.get(filePath);
    if (!registered) return;
    runtimes.delete(filePath);
    try {
      await registered.runtime.destroy();
    } catch (error) {
      onObserverError?.(error);
    }
  };
  const restoreRuntimeAfterFailedRemoval = (
    filePath: string,
    registered: RegisteredDocumentRuntime | undefined,
  ): void => {
    if (!registered || runtimes.get(filePath) !== registered) return;
    registered.generation = runtimeGenerations.get(filePath) ?? registered.generation;
  };
  const cancelled = (
    filePath: string,
    expectedGeneration: number,
    options?: ReaderActionOptions,
  ): boolean =>
    generation(filePath) !== expectedGeneration ||
    isRemovalPending(filePath) ||
    !hasSessionDocument(filePath) ||
    Boolean(options?.isCancelled?.());

  const runDocumentContentOperation = async <T>(
    filePath: string,
    expectedGeneration: number,
    options: ReaderActionOptions | undefined,
    operation: (runtime: DocumentRuntime, isCancelled: () => boolean) => Promise<T>,
  ): Promise<DocumentContentOperationResult<T>> => {
    if (cancelled(filePath, expectedGeneration, options)) {
      return { status: 'no-op', revision: revision() };
    }
    const registered = runtimes.get(filePath);
    if (!registered) {
      return {
        status: 'failure',
        error: new Error(`Document Content is unavailable: ${filePath}`),
        revision: revision(),
      };
    }
    const operationCancelled = () =>
      cancelled(filePath, expectedGeneration, options) || runtimes.get(filePath) !== registered;
    const value = await operation(registered.runtime, operationCancelled);
    return operationCancelled()
      ? { status: 'no-op', revision: revision() }
      : { status: 'ready', value };
  };

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

  const projectActivation = async (
    document: ReadingSessionDocument,
    readingPosition: RestorableReadingPosition,
  ): Promise<Extract<ReaderActionOutcome, { status: 'failure' }> | null> => {
    let restorePresentation: RestorePresentation | undefined;
    try {
      restorePresentation = await projection.exitPresentation?.();
    } catch (error) {
      return { status: 'failure', error, revision: revision() };
    }
    try {
      await projection.activateDocument(document.filePath, readingPosition, document.visualState);
      return null;
    } catch (error) {
      if (!restorePresentation) return { status: 'failure', error, revision: revision() };
      try {
        await restorePresentation();
        return { status: 'failure', error, revision: revision() };
      } catch (restoreError) {
        return {
          status: 'failure',
          error: new AggregateError(
            [error, restoreError],
            'Document activation and presentation restoration failed',
          ),
          revision: revision(),
        };
      }
    }
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
    expectedGeneration = generation(filePath),
  ): Promise<ReaderActionOutcome> => {
    const lane = laneFor(filePath);
    const existing = lane.pendingAbsolute.get(kind);
    if (existing) {
      existing.superseded = true;
      existing.resolve({ status: 'superseded', revision: revision() });
    }

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
    expectedGeneration = generation(filePath),
  ): Promise<ReaderActionOutcome> => {
    const lane = laneFor(filePath);
    const outcome = lane.tail
      .catch(() => undefined)
      .then(() => work(expectedGeneration))
      .catch((error): ReaderActionOutcome => ({ status: 'failure', error, revision: revision() }));
    lane.tail = outcome.then(() => undefined);
    return outcome;
  };

  const enqueueGlobal = (
    work: () => Promise<ReaderActionOutcome>,
    reservationFilePath?: string,
  ): Promise<ReaderActionOutcome> => {
    const reservation = activeReopenReservation;
    if (reservation && reservation.filePath === reservationFilePath) {
      const outcome = reservation.tail.catch(() => undefined).then(work);
      reservation.tail = outcome.then(
        () => undefined,
        () => undefined,
      );
      return outcome;
    }
    const outcome = globalTail.catch(() => undefined).then(work);
    globalTail = outcome.then(
      () => undefined,
      () => undefined,
    );
    return outcome;
  };

  const routeDocumentAction = (
    requestedPath: string | undefined,
    enqueue: (filePath: string, expectedGeneration?: number) => Promise<ReaderActionOutcome>,
  ): Promise<ReaderActionOutcome> => {
    const captured = session.snapshot();
    const filePath = requestedPath ?? captured.activeDocumentPath;
    if (!filePath) {
      return Promise.resolve({ status: 'no-op', revision: captured.revision });
    }
    const expectedGeneration = captured.documents.some((document) => document.filePath === filePath)
      ? generation(filePath)
      : undefined;
    const precedingGlobal = globalTail;
    return precedingGlobal
      .catch(() => undefined)
      .then(() => enqueue(filePath, expectedGeneration))
      .catch((error): ReaderActionOutcome => ({ status: 'failure', error, revision: revision() }));
  };

  const routeAbsoluteDocumentAction = (
    requestedPath: string | undefined,
    kind: AbsoluteActionKind,
    work: (filePath: string, expectedGeneration: number) => Promise<ReaderActionOutcome>,
  ): Promise<ReaderActionOutcome> =>
    routeDocumentAction(requestedPath, (filePath, capturedGeneration) =>
      enqueueAbsolute(
        filePath,
        kind,
        (expectedGeneration) => work(filePath, expectedGeneration),
        capturedGeneration,
      ),
    );

  const routeRelativeDocumentAction = (
    requestedPath: string | undefined,
    work: (filePath: string, expectedGeneration: number) => Promise<ReaderActionOutcome>,
  ): Promise<ReaderActionOutcome> =>
    routeDocumentAction(requestedPath, (filePath, capturedGeneration) =>
      enqueueRelative(
        filePath,
        (expectedGeneration) => work(filePath, expectedGeneration),
        capturedGeneration,
      ),
    );

  const enqueueSettledUpdate = (
    filePath: string,
    kind: AbsoluteActionKind,
    options: ReaderActionOptions | undefined,
    update: (document: ReadingSessionDocument) => ReadingSessionDocument | null,
  ): Promise<ReaderActionOutcome> =>
    routeAbsoluteDocumentAction(filePath, kind, async (routedPath, expectedGeneration) => {
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
    });

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
    project: (
      current: ReadingSessionVisualState,
      projectionOptions: ReaderActionOptions,
    ) => Promise<ReadingSessionVisualState | null>,
  ): Promise<ReaderActionOutcome> => {
    if (cancelled(filePath, expectedGeneration, options)) {
      return { status: 'no-op', revision: revision() };
    }
    const document = session.snapshot().documents.find((item) => item.filePath === filePath);
    if (!document) return { status: 'no-op', revision: revision() };

    let visualState: ReadingSessionVisualState | null;
    try {
      visualState = await project(document.visualState ?? createDefaultVisualState(), {
        isCancelled: () => cancelled(filePath, expectedGeneration, options),
      });
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
      for (const { canonicalPath, document } of paths) {
        if (document && !preferredDocumentByCanonicalPath.has(canonicalPath)) {
          preferredDocumentByCanonicalPath.set(canonicalPath, document);
        }
      }
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
        if (preferredDocument !== document) changed = true;
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

  const quiesce = async (): Promise<void> => {
    while (true) {
      const capturedGlobalTail = globalTail;
      const capturedRecoveryTail = recoveryTail;
      const capturedDocumentTails = Array.from(
        lanes,
        ([filePath, lane]) => [filePath, lane.tail] as const,
      );
      await Promise.allSettled([
        capturedGlobalTail,
        capturedRecoveryTail,
        ...capturedDocumentTails.map(([, tail]) => tail),
      ]);
      const unchanged =
        capturedGlobalTail === globalTail &&
        capturedRecoveryTail === recoveryTail &&
        capturedDocumentTails.length === lanes.size &&
        capturedDocumentTails.every(([filePath, tail]) => lanes.get(filePath)?.tail === tail);
      if (unchanged) return;
    }
  };

  // A discard decision authorizes only the live runtime and revision the reader saw.
  const discards = new Map<DocumentRuntime, number>();
  const mayDestroy = (filePath: string): boolean => {
    const runtime = runtimes.get(filePath)?.runtime;
    const state = runtime?.editing?.state();
    return !state?.dirty || (runtime !== undefined && discards.get(runtime) === state.revision);
  };
  const removeDocument = (
    action: Extract<ReaderAction, { type: 'closeDocument' | 'removeDocument' }>,
  ): Promise<ReaderActionOutcome> => {
    const lane = laneFor(action.filePath);
    lane.pendingRemovals += 1;
    lane.generation += 1;
    const invalidatedRuntime = invalidateRuntime(action.filePath);
    for (const pending of lane.pendingAbsolute.values()) {
      pending.superseded = true;
      pending.resolve({ status: 'no-op', revision: revision() });
    }
    lane.pendingAbsolute.clear();

    return enqueueGlobal(
      async () => {
        try {
          if (runtimes.get(action.filePath) !== invalidatedRuntime) {
            return { status: 'superseded', revision: revision() };
          }
          const current = session.snapshot();
          const transition = closeDocumentTransition(current, action.filePath);
          if (!transition) {
            restoreRuntimeAfterFailedRemoval(action.filePath, invalidatedRuntime);
            return { status: 'no-op', revision: current.revision };
          }
          if (action.type === 'closeDocument' && !projection.closeDocument) {
            restoreRuntimeAfterFailedRemoval(action.filePath, invalidatedRuntime);
            return {
              status: 'failure',
              error: new Error('Reader projection cannot close a Document'),
              revision: current.revision,
            };
          }
          try {
            if (current.activeDocumentPath === action.filePath) {
              await projection.exitPresentation?.({ restoreVisualState: false });
            }
            if (
              pendingReloads.has(action.filePath) ||
              pendingSaves.has(action.filePath) ||
              !mayDestroy(action.filePath)
            ) {
              throw new Error('Document changed during the close decision; retry closing.');
            }
            await projection.closeDocument?.(action.filePath, transition.activeDocumentPath);
          } catch (error) {
            restoreRuntimeAfterFailedRemoval(action.filePath, invalidatedRuntime);
            return { status: 'failure', error, revision: revision() };
          }
          const latest = session.snapshot();
          const latestTransition = closeDocumentTransition(latest, action.filePath);
          if (!latestTransition) return { status: 'no-op', revision: latest.revision };
          const outcome = await commit({ schemaVersion: 2, ...latestTransition }, 'immediate');
          await removeRuntime(action.filePath);
          if (action.type === 'closeDocument') {
            recentlyClosedDocumentPaths.push(action.filePath);
          }
          return outcome;
        } finally {
          lane.pendingRemovals -= 1;
        }
      },
      action.type === 'removeDocument' ? action.filePath : undefined,
    );
  };

  let decisionTail = Promise.resolve();
  const pendingCloses = new Map<string, Promise<ReaderActionOutcome>>();
  const enqueueDecision = <T>(work: () => Promise<T>): Promise<T> => {
    const result = decisionTail.then(work);
    decisionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const runtimePath = (runtime: DocumentRuntime): string | undefined =>
    [...runtimes].find(([, registered]) => registered.runtime === runtime)?.[0];

  const persistRecoveryDraft = async (
    runtime: DocumentRuntime,
    documentPath: string,
    sourceVersion: string,
  ): Promise<boolean> => {
    if (!recoveryDraftAdapter) return false;
    while (true) {
      const editing = runtime.editing;
      if (!editing) return false;
      const state = editing.state();
      if (!state.dirty || state.readOnlyReason) return false;
      const bytes = await exportPdf(runtime, editing);
      if (editing.state().revision !== state.revision) continue;
      await recoveryDraftAdapter.write({
        documentPath,
        sourceVersion,
        editedRevision: state.revision,
        bytes,
      });
      if (editing.state().revision === state.revision) return true;
    }
  };

  const captureRecoveryDraft = (filePath: string): Promise<ReaderActionOutcome> => {
    const registered = runtimes.get(filePath);
    if (!registered || !recoveryDraftAdapter)
      return Promise.resolve({ status: 'no-op', revision: revision() });
    const runtime = registered.runtime;
    const pending = pendingDraftCaptures.get(runtime);
    if (pending) return pending;
    const capture = enqueueRecovery(async (): Promise<ReaderActionOutcome> => {
      try {
        const currentPath = runtimePath(runtime);
        const sourceVersion = runtime.recovery?.sourceVersion;
        if (!currentPath || !sourceVersion) return { status: 'no-op', revision: revision() };
        const document = session.snapshot().documents.find((item) => item.filePath === currentPath);
        if (!document) return { status: 'no-op', revision: revision() };
        const persisted = await persistRecoveryDraft(runtime, currentPath, sourceVersion);
        return { status: persisted ? 'performed' : 'no-op', revision: revision() };
      } catch (error) {
        return { status: 'failure', error, revision: revision() };
      }
    });
    pendingDraftCaptures.set(runtime, capture);
    void capture.finally(() => {
      if (pendingDraftCaptures.get(runtime) === capture) pendingDraftCaptures.delete(runtime);
    });
    return capture;
  };

  const reconcileRecoveryDraft = async (
    runtime: DocumentRuntime,
    previousDocumentPath: string,
    documentPath: string,
    persistedRevision: number,
    sourceBytes: Uint8Array,
  ): Promise<void> => {
    if (!recoveryDraftAdapter || !runtime.recovery) return;
    const result = await enqueueRecovery(() =>
      recoveryDraftAdapter.reconcile({
        previousDocumentPath,
        documentPath,
        persistedRevision,
        sourceBytes,
      }),
    );
    runtime.recovery = { sourceVersion: result.sourceVersion };
  };

  const refreshRecoveryDraftAfterOriginalWrite = async (
    runtime: DocumentRuntime,
    documentPath: string,
    sourceBytes: Uint8Array,
  ): Promise<void> => {
    if (!recoveryDraftAdapter || !runtime.recovery) return;
    const repairAfterWrite = recoveryDraftAdapter.repairAfterWrite;
    if (!repairAfterWrite) throw new Error('Recovery Draft repair is unavailable');
    await enqueueRecovery(async () => {
      while (true) {
        const editing = runtime.editing;
        if (!editing) return;
        const state = editing.state();
        if (!state.dirty || state.readOnlyReason) {
          await recoveryDraftAdapter.remove(documentPath);
          return;
        }
        const draftBytes = await exportPdf(runtime, editing);
        if (editing.state().revision !== state.revision) continue;
        const result = await repairAfterWrite({
          documentPath,
          sourceBytes,
          editedRevision: state.revision,
          draftBytes,
        });
        runtime.recovery = { sourceVersion: result.sourceVersion };
        if (editing.state().revision === state.revision) return;
      }
    });
  };

  const removeRecoveryDraft = (documentPath: string): Promise<void> =>
    recoveryDraftAdapter
      ? enqueueRecovery(() => recoveryDraftAdapter.remove(documentPath))
      : Promise.resolve();

  const saveDocument = async (
    action: Extract<ReaderAction, { type: 'saveDocumentAs' | 'saveDocument' }>,
    options?: ReaderActionOptions,
  ): Promise<ReaderActionOutcome> => {
    const saveAs = action.type === 'saveDocumentAs';
    const captured = session.snapshot();
    const filePath = action.filePath ?? captured.activeDocumentPath;
    if (!filePath) return { status: 'no-op', revision: revision() };
    if (pendingReloads.has(filePath))
      return {
        status: 'failure',
        error: new Error('Finish reloading before saving this Document'),
        revision: revision(),
      };
    const pending = pendingSaves.get(filePath);
    if (pending) return pending;
    const registered = runtimes.get(filePath);
    const editing = registered?.runtime.editing;
    const document = captured.documents.find((item) => item.filePath === filePath);
    if (
      !registered ||
      !editing ||
      !document ||
      !pdfSaveAdapter ||
      !projection.verifySavedDocument ||
      (saveAs
        ? !projection.reidentifyDocument
        : !pdfSaveAdapter.writeOriginal || !registered.runtime.saveSource)
    ) {
      return {
        status: 'failure',
        error: new Error('Native PDF saving is unavailable'),
        revision: revision(),
      };
    }
    const state = editing.state();
    if (state.readOnlyReason)
      return {
        status: 'failure',
        error: new Error(state.readOnlyReason),
        revision: revision(),
      };
    const expectedGeneration = generation(filePath);
    const isCancelled = () =>
      cancelled(filePath, expectedGeneration, options) || runtimes.get(filePath) !== registered;
    const save = (async (): Promise<ReaderActionOutcome> => {
      let destination: PdfSaveDestination | null = null;
      let replacementSource: string | undefined;
      try {
        if (isCancelled()) return { status: 'superseded', revision: revision() };
        if (saveAs) {
          destination = await pdfSaveAdapter.chooseDestination(document.title);
          if (!destination || isCancelled()) return { status: 'superseded', revision: revision() };
          if (
            session
              .snapshot()
              .documents.some((item) => item.filePath === destination?.canonicalPath)
          ) {
            throw new Error('Save As destination is already open');
          }
        }
        const exportedRevision = editing.state().revision;
        const bytes = await exportPdf(registered.runtime, editing);
        if (editing.state().revision !== exportedRevision)
          throw new Error('Annotations changed during export; retry Save');
        if (isCancelled()) return { status: 'superseded', revision: revision() };
        const sourceToken = registered.runtime.saveSource;
        if (!sourceToken) throw new Error('Source Document is no longer authorized');
        let reopened: Uint8Array;
        if (saveAs && destination)
          reopened = await pdfSaveAdapter.writeDestination(destination, bytes, sourceToken);
        else if (pdfSaveAdapter.writeOriginal)
          reopened = await pdfSaveAdapter.writeOriginal(sourceToken, bytes);
        else throw new Error('Original PDF saving is unavailable');
        if (!saveAs) {
          try {
            if (isCancelled()) throw new Error('Save was superseded after writing the PDF');
            if (
              bytes.length !== reopened.length ||
              bytes.some((value, index) => value !== reopened[index])
            )
              throw new Error('Written PDF verification failed');
            await reconcileRecoveryDraft(
              registered.runtime,
              filePath,
              filePath,
              exportedRevision,
              reopened,
            );
            await projection.verifySavedDocument?.(document, reopened, { isCancelled });
            if (isCancelled()) throw new Error('Save was superseded after writing the PDF');
            editing.markSaved(exportedRevision);
            return { status: 'performed', revision: revision() };
          } catch (error) {
            try {
              await refreshRecoveryDraftAfterOriginalWrite(registered.runtime, filePath, reopened);
            } catch (recoveryError) {
              throw new AggregateError(
                [error, recoveryError],
                'The PDF was written, but its Recovery Draft could not be refreshed. Keep Monight open and retry Save.',
              );
            }
            if (isCancelled()) return { status: 'superseded', revision: revision() };
            throw error;
          }
        }
        if (isCancelled()) return { status: 'superseded', revision: revision() };
        if (
          bytes.length !== reopened.length ||
          bytes.some((value, index) => value !== reopened[index])
        )
          throw new Error('Written PDF verification failed');
        if (!destination) throw new Error('Missing Save As destination');
        replacementSource = await pdfSaveAdapter.captureSource?.(
          destination.canonicalPath,
          reopened,
        );
        const selected = destination;
        return await enqueueGlobal(async () => {
          if (isCancelled()) return { status: 'superseded', revision: revision() };
          const current = session.snapshot();
          if (current.documents.some((item) => item.filePath === selected.canonicalPath))
            throw new Error('Save As destination is already open');
          const origin = current.documents.find((item) => item.filePath === filePath);
          if (!origin) return { status: 'superseded', revision: revision() };
          const replacement = {
            ...origin,
            filePath: selected.canonicalPath,
            title: selected.title,
          };
          await projection.verifySavedDocument?.(replacement, reopened, { isCancelled });
          if (isCancelled()) return { status: 'superseded', revision: revision() };
          await reconcileRecoveryDraft(
            registered.runtime,
            filePath,
            selected.canonicalPath,
            exportedRevision,
            reopened,
          );
          projection.reidentifyDocument?.(filePath, selected);
          invalidateRuntime(filePath);
          runtimes.delete(filePath);
          const nextGeneration = (runtimeGenerations.get(selected.canonicalPath) ?? 0) + 1;
          runtimeGenerations.set(selected.canonicalPath, nextGeneration);
          runtimes.set(selected.canonicalPath, {
            generation: nextGeneration,
            runtime: registered.runtime,
          });
          laneFor(filePath).generation += 1;
          laneFor(selected.canonicalPath).generation += 1;
          const oldSource = registered.runtime.saveSource;
          registered.runtime.saveSource = replacementSource;
          replacementSource = undefined;
          if (oldSource) void pdfSaveAdapter.releaseSource?.(oldSource).catch(() => undefined);
          editing.markSaved(exportedRevision);
          const latest = session.snapshot();
          return commit(
            {
              schemaVersion: 2,
              activeDocumentPath:
                latest.activeDocumentPath === filePath
                  ? selected.canonicalPath
                  : latest.activeDocumentPath,
              documents: latest.documents.map((item) =>
                item.filePath === filePath
                  ? { ...item, filePath: selected.canonicalPath, title: selected.title }
                  : item,
              ),
            },
            'immediate',
          );
        });
      } catch (error) {
        return { status: 'failure', error, revision: revision() };
      } finally {
        if (replacementSource)
          await pdfSaveAdapter.releaseSource?.(replacementSource).catch(() => undefined);
        if (destination)
          await pdfSaveAdapter.releaseDestination(destination).catch(() => undefined);
      }
    })();
    pendingSaves.set(filePath, save);
    try {
      return await save;
    } finally {
      pendingSaves.delete(filePath);
    }
  };

  const decideUnsavedDocument = async (
    runtime: DocumentRuntime,
    options?: ReaderActionOptions,
  ): Promise<boolean> => {
    let error: unknown;
    while (true) {
      const filePath = runtimePath(runtime);
      if (!filePath || options?.isCancelled?.()) return false;
      const pending = pendingSaves.get(filePath);
      if (pending) {
        const result = await pending;
        if (result.status === 'failure') error = result.error;
        continue;
      }
      if (pendingReloads.has(filePath)) await quiesce();
      if (runtimePath(runtime) !== filePath) continue;
      if (mayDestroy(filePath)) return true;
      if (pendingSaves.size > 0) {
        await Promise.allSettled([...pendingSaves.values()]);
        continue;
      }
      const document = session.snapshot().documents.find((item) => item.filePath === filePath);
      if (!document || !chooseUnsavedDocument) return false;
      const editRevision = runtime.editing?.state().revision;
      const choice = await chooseUnsavedDocument({ ...document, error });
      if (options?.isCancelled?.() || runtimePath(runtime) !== filePath) return false;
      if (choice === 'cancel') return false;
      if (runtime.editing?.state().revision !== editRevision) continue;
      if (choice === 'discard') {
        try {
          await removeRecoveryDraft(filePath);
          if (editRevision !== undefined) discards.set(runtime, editRevision);
          return true;
        } catch (removeError) {
          error = removeError;
          continue;
        }
      }
      const result = await saveDocument(
        {
          type: choice === 'save-as' ? 'saveDocumentAs' : 'saveDocument',
          filePath,
        },
        options,
      );
      if (result.status === 'failure') error = result.error;
      else if (result.status !== 'performed' && result.status !== 'committed') return false;
      else error = undefined;
    }
  };

  let shutdownRequested = false;
  let shutdownPreparation: Promise<boolean> | null = null;
  const cancelShutdown = (): void => {
    shutdownRequested = false;
    shutdownPreparation = null;
    discards.clear();
  };
  const isShutdownPrepared = (): boolean =>
    shutdownRequested &&
    pendingSaves.size === 0 &&
    pendingReloads.size === 0 &&
    pendingCloses.size === 0 &&
    [...runtimes.keys()].every(mayDestroy);

  const reader: ReaderActions = {
    async dispatch(action, options) {
      if (shutdownRequested && action.type !== 'settleReadingPosition')
        return { status: 'no-op', revision: revision() };
      if (action.type === 'discardAndReloadDocument') {
        const filePath = action.filePath ?? session.snapshot().activeDocumentPath;
        if (!filePath) return { status: 'no-op', revision: revision() };
        const registered = runtimes.get(filePath);
        const editRevision = registered?.runtime.editing?.state().revision;
        const expectedGeneration = generation(filePath);
        const isCancelled = () =>
          cancelled(filePath, expectedGeneration, options) ||
          runtimes.get(filePath) !== registered ||
          registered?.runtime.editing?.state().revision !== editRevision;
        if (pendingReloads.has(filePath) || pendingSaves.has(filePath))
          return {
            status: 'failure',
            error: new Error('A save or reload is already in progress'),
            revision: revision(),
          };
        pendingReloads.add(filePath);
        return enqueueGlobal(async () => {
          // Earlier routed actions have joined this lane; later ones await this global turn.
          await laneFor(filePath).tail;
          const document = session.snapshot().documents.find((item) => item.filePath === filePath);
          if (!document || !registered || isCancelled())
            return { status: 'superseded', revision: revision() };
          if (pendingSaves.has(filePath) || !projection.prepareReloadDocument)
            return {
              status: 'failure',
              error: new Error('Finish saving before reloading this Document'),
              revision: revision(),
            };
          let prepared:
            | Awaited<ReturnType<NonNullable<ReaderProjection['prepareReloadDocument']>>>
            | undefined;
          try {
            await removeRecoveryDraft(filePath);
            if (isCancelled()) return { status: 'superseded', revision: revision() };
            prepared = await projection.prepareReloadDocument(document, { isCancelled });
            if (isCancelled()) return { status: 'superseded', revision: revision() };
            prepared.commit();
            invalidateRuntime(filePath);
            const nextGeneration = (runtimeGenerations.get(filePath) ?? 0) + 1;
            runtimeGenerations.set(filePath, nextGeneration);
            runtimes.set(filePath, { generation: nextGeneration, runtime: prepared.runtime });
            laneFor(filePath).generation += 1;
            prepared = undefined;
            await registered.runtime.destroy().catch((error) => onObserverError?.(error));
            return { status: 'performed', revision: revision() };
          } catch (error) {
            return { status: 'failure', error, revision: revision() };
          } finally {
            await prepared?.dispose();
          }
        }).finally(() => {
          pendingReloads.delete(filePath);
        });
      }
      if (action.type === 'saveDocumentAs' || action.type === 'saveDocument') {
        // A close owns the decision UI; only join an already-running explicit save.
        if (pendingCloses.size > 0) {
          const filePath = action.filePath ?? session.snapshot().activeDocumentPath;
          return (
            (filePath && pendingSaves.get(filePath)) || { status: 'no-op', revision: revision() }
          );
        }
        return saveDocument(action, options);
      }
      if (action.type === 'reorderDocuments') {
        return enqueueGlobal(async () => {
          const current = session.snapshot();
          const requestedPaths = action.filePaths;
          const requestedPathSet = new Set(requestedPaths);
          const currentPaths = current.documents.map((document) => document.filePath);
          const includesEveryDocument = currentPaths.every((filePath) =>
            requestedPathSet.has(filePath),
          );
          if (
            requestedPaths.length !== current.documents.length ||
            requestedPathSet.size !== requestedPaths.length ||
            !includesEveryDocument
          ) {
            return {
              status: 'failure',
              error: new Error('Document order must include every open Document exactly once'),
              revision: current.revision,
            };
          }
          if (requestedPaths.every((filePath, index) => filePath === currentPaths[index])) {
            return { status: 'no-op', revision: current.revision };
          }
          const documentsByPath = new Map(
            current.documents.map((document) => [document.filePath, document]),
          );
          const documents = requestedPaths.map((filePath) => {
            const document = documentsByPath.get(filePath);
            if (!document) throw new Error(`Document is not open: ${filePath}`);
            return document;
          });
          return commit(
            { schemaVersion: 2, activeDocumentPath: current.activeDocumentPath, documents },
            'immediate',
          );
        });
      }

      if (action.type === 'reopenLastClosedDocument') {
        const precedingGlobal = globalTail;
        let releaseReservation!: () => void;
        const reservationBarrier = new Promise<void>((resolve) => {
          releaseReservation = resolve;
        });
        globalTail = precedingGlobal.catch(() => undefined).then(() => reservationBarrier);
        return precedingGlobal
          .catch(() => undefined)
          .then(async (): Promise<ReaderActionOutcome> => {
            let reservation: GlobalLaneReservation | null = null;
            try {
              const index = recentlyClosedDocumentPaths.length - 1;
              const filePath = recentlyClosedDocumentPaths[index];
              if (!filePath) return { status: 'no-op', revision: revision() };
              if (!reopenDocument) {
                return {
                  status: 'failure',
                  error: new Error('Reader Actions cannot reopen a Document'),
                  revision: revision(),
                };
              }
              reservation = { filePath, tail: Promise.resolve() };
              activeReopenReservation = reservation;
              try {
                await reopenDocument(filePath);
                await reservation.tail.catch(() => undefined);
                recentlyClosedDocumentPaths.splice(index, 1);
                return { status: 'committed', revision: revision() };
              } catch (error) {
                return { status: 'failure', error, revision: revision() };
              }
            } finally {
              if (activeReopenReservation === reservation) activeReopenReservation = null;
              releaseReservation();
            }
          });
      }

      if (action.type === 'closeDocument' || action.type === 'removeDocument') {
        const pending = pendingCloses.get(action.filePath);
        if (pending) return pending;
        const runtime = runtimes.get(action.filePath)?.runtime;
        const needsDecision =
          runtime &&
          (runtime.editing?.state().dirty ||
            pendingSaves.has(action.filePath) ||
            pendingReloads.has(action.filePath));
        if (!needsDecision) {
          const result = removeDocument(action).finally(() => {
            pendingCloses.delete(action.filePath);
          });
          pendingCloses.set(action.filePath, result);
          return result;
        }
        if (!chooseUnsavedDocument)
          return {
            status: 'failure',
            error: new Error('Unsaved Document close decisions are unavailable'),
            revision: revision(),
          };
        const result = enqueueDecision(async (): Promise<ReaderActionOutcome> => {
          try {
            if (!(await decideUnsavedDocument(runtime, options)))
              return { status: 'no-op', revision: revision() };
            const filePath = runtimePath(runtime);
            if (!filePath) return { status: 'superseded', revision: revision() };
            return await removeDocument({ ...action, filePath });
          } catch (error) {
            return { status: 'failure', error, revision: revision() };
          } finally {
            discards.delete(runtime);
          }
        }).finally(() => {
          pendingCloses.delete(action.filePath);
        });
        pendingCloses.set(action.filePath, result);
        return result;
      }

      if (action.type === 'registerDocument') {
        return enqueueGlobal(async () => {
          const current = session.snapshot();
          if (options?.isCancelled?.()) {
            return { status: 'superseded', revision: current.revision };
          }
          const existingRuntime = runtimes.get(action.document.filePath);
          if (existingRuntime && existingRuntime.runtime !== action.runtime) {
            try {
              await action.runtime.destroy();
            } catch (error) {
              onObserverError?.(error);
            }
            return {
              status: 'failure',
              error: new Error(`Document Content already registered: ${action.document.filePath}`),
              revision: current.revision,
            };
          }
          const existingDocument = current.documents.find(
            (item) => item.filePath === action.document.filePath,
          );
          const document = existingDocument ?? action.document;
          const readingPosition = action.readingPosition ?? document.readingPosition;
          if (action.activate && !validReadingPosition(readingPosition)) {
            return { status: 'no-op', revision: current.revision };
          }
          if (action.activate) {
            const activationFailure = await projectActivation(document, readingPosition);
            if (activationFailure) return activationFailure;
            if (options?.isCancelled?.()) {
              return { status: 'superseded', revision: revision() };
            }
          }
          if (!existingRuntime) {
            const nextGeneration = (runtimeGenerations.get(action.document.filePath) ?? 0) + 1;
            runtimeGenerations.set(action.document.filePath, nextGeneration);
            runtimes.set(action.document.filePath, {
              generation: nextGeneration,
              runtime: action.runtime,
            });
          }
          let next: PersistedReadingSession = existingDocument
            ? current
            : {
                schemaVersion: 2,
                activeDocumentPath: current.activeDocumentPath,
                documents: [...current.documents, document],
              };
          if (action.activate) {
            const activated = activateDocumentTransition(next, document, readingPosition);
            if (activated) next = activated;
          }
          if (next === current) return { status: 'no-op', revision: current.revision };
          const lane = laneFor(action.document.filePath);
          if (!existingDocument) lane.generation += 1;
          return commit(next, 'immediate');
        }, action.document.filePath);
      }

      if (action.type === 'activateDocument') {
        if (action.readingPosition && !validReadingPosition(action.readingPosition)) {
          return { status: 'no-op', revision: revision() };
        }
        return enqueueGlobal(async () => {
          const current = session.snapshot();
          if (options?.isCancelled?.()) {
            return { status: 'superseded', revision: current.revision };
          }
          const document = current.documents.find((item) => item.filePath === action.filePath);
          if (!document) return { status: 'no-op', revision: current.revision };
          const readingPosition = action.readingPosition ?? document.readingPosition;
          const activationFailure = await projectActivation(document, readingPosition);
          if (activationFailure) return activationFailure;
          if (options?.isCancelled?.()) {
            return { status: 'superseded', revision: revision() };
          }
          const latest = session.snapshot();
          const latestDocument = latest.documents.find(
            (item) => item.filePath === document.filePath,
          );
          if (!latestDocument) {
            return { status: 'no-op', revision: latest.revision };
          }
          const activated = activateDocumentTransition(latest, latestDocument, readingPosition);
          return activated
            ? commit(activated, 'immediate')
            : { status: 'no-op', revision: latest.revision };
        }, action.filePath);
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

      if (action.type === 'activateDocumentTarget') {
        return routeRelativeDocumentAction(
          action.filePath,
          async (filePath, expectedGeneration) => {
            const resolution = await runDocumentContentOperation(
              filePath,
              expectedGeneration,
              options,
              (runtime, isCancelled) =>
                runtime.content.resolveLinkTarget(action.target, { isCancelled }),
            );
            if (resolution.status !== 'ready') return resolution;
            const resolved = resolution.value;
            if (!resolved) return { status: 'no-op', revision: revision() };
            if (resolved.kind === 'external') {
              if (externalLinkAdapter) {
                await externalLinkAdapter.open(resolved.url);
                return { status: 'performed', revision: revision() };
              }
              return {
                status: 'failure',
                error: new Error('Reader Actions cannot open an external link'),
                revision: revision(),
              };
            }

            const readingPosition = {
              page: resolved.pageNumber,
              location: resolved.location ?? 0,
            };
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
            const documents = latest.documents.map((document) =>
              document.filePath === filePath ? { ...document, readingPosition } : document,
            );
            return commit(
              { schemaVersion: 2, activeDocumentPath: latest.activeDocumentPath, documents },
              'deferred',
            );
          },
        );
      }

      if (action.type === 'printDocument') {
        return routeRelativeDocumentAction(
          action.filePath,
          async (filePath, expectedGeneration) => {
            if (cancelled(filePath, expectedGeneration, options)) {
              return { status: 'no-op', revision: revision() };
            }
            const current = session.snapshot();
            const document = current.documents.find((item) => item.filePath === filePath);
            if (!document) return { status: 'no-op', revision: current.revision };
            if (!printAdapter) {
              return {
                status: 'failure',
                error: new Error('Reader Actions cannot print a Document'),
                revision: current.revision,
              };
            }
            const data = await runDocumentContentOperation(
              filePath,
              expectedGeneration,
              options,
              (runtime) => runtime.content.getData(),
            );
            if (data.status !== 'ready') return data;
            await printAdapter.print({
              filePath,
              title: document.title,
              bytes: data.value,
            });
            return { status: 'performed', revision: revision() };
          },
        );
      }

      if (action.type === 'setZoomIntent') {
        if (!validZoomIntent(action.zoomIntent)) {
          return { status: 'no-op', revision: revision() };
        }

        return routeAbsoluteDocumentAction(
          action.filePath,
          'zoomIntent',
          (filePath, expectedGeneration) =>
            projectVisualState(
              filePath,
              expectedGeneration,
              options,
              async (current, projectionOptions) => {
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
                  projectionOptions,
                );
                return validZoomIntent(zoomIntent) ? { ...current, zoomIntent } : null;
              },
            ),
        );
      }

      if (action.type === 'zoomIn' || action.type === 'zoomOut') {
        return routeRelativeDocumentAction(action.filePath, (filePath, expectedGeneration) =>
          projectVisualState(
            filePath,
            expectedGeneration,
            options,
            async (current, projectionOptions) => {
              if (!projection.applyRelativeZoom) {
                throw new Error('Reader projection cannot apply relative zoom');
              }
              const zoomIntent = await projection.applyRelativeZoom(
                filePath,
                action.type === 'zoomIn' ? 'in' : 'out',
                projectionOptions,
              );
              return validZoomIntent(zoomIntent) ? { ...current, zoomIntent } : null;
            },
          ),
        );
      }

      if (action.type === 'rotateClockwise' || action.type === 'rotateCounterClockwise') {
        return routeRelativeDocumentAction(action.filePath, (filePath, expectedGeneration) =>
          projectVisualState(
            filePath,
            expectedGeneration,
            options,
            async (current, projectionOptions) => {
              const rotation = normalizeRotation(
                current.rotation + (action.type === 'rotateClockwise' ? 90 : -90),
              );
              if (!projection.applyRotation) {
                throw new Error('Reader projection cannot apply rotation');
              }
              await projection.applyRotation(filePath, rotation, projectionOptions);
              return { ...current, rotation };
            },
          ),
        );
      }

      if (action.type === 'setViewMode') {
        return routeAbsoluteDocumentAction(
          action.filePath,
          'viewMode',
          (filePath, expectedGeneration) =>
            projectVisualState(
              filePath,
              expectedGeneration,
              options,
              async (current, projectionOptions) => {
                if (current.viewMode === action.viewMode) return null;
                if (!projection.applyViewMode) {
                  throw new Error('Reader projection cannot apply view mode');
                }
                await projection.applyViewMode(filePath, action.viewMode, projectionOptions);
                return { ...current, viewMode: action.viewMode };
              },
            ),
        );
      }

      if (action.type === 'cycleViewMode') {
        return routeRelativeDocumentAction(action.filePath, (filePath, expectedGeneration) =>
          projectVisualState(
            filePath,
            expectedGeneration,
            options,
            async (current, projectionOptions) => {
              const viewMode = nextViewMode(current.viewMode);
              if (!projection.applyViewMode) {
                throw new Error('Reader projection cannot apply view mode');
              }
              await projection.applyViewMode(filePath, viewMode, projectionOptions);
              return { ...current, viewMode };
            },
          ),
        );
      }

      if (action.type === 'setFilterSettings') {
        if (!validFilterSettings(action.filterSettings)) {
          return { status: 'no-op', revision: revision() };
        }
        return routeAbsoluteDocumentAction(
          action.filePath,
          'filterSettings',
          (filePath, expectedGeneration) =>
            projectVisualState(
              filePath,
              expectedGeneration,
              options,
              async (current, projectionOptions) => {
                if (filterSettingsEqual(current.filterSettings, action.filterSettings)) return null;
                if (!projection.applyFilterSettings) {
                  throw new Error('Reader projection cannot apply filter settings');
                }
                await projection.applyFilterSettings(
                  filePath,
                  action.filterSettings,
                  projectionOptions,
                );
                return { ...current, filterSettings: { ...action.filterSettings } };
              },
            ),
        );
      }

      if (action.type === 'goToNextPage' || action.type === 'goToPreviousPage') {
        return routeRelativeDocumentAction(
          action.filePath,
          async (filePath, expectedGeneration) => {
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
          },
        );
      }

      if (!Number.isInteger(action.page) || action.page < 1) {
        return { status: 'no-op', revision: revision() };
      }

      return routeAbsoluteDocumentAction(
        action.filePath,
        'readingPosition',
        async (filePath, expectedGeneration) => {
          if (cancelled(filePath, expectedGeneration, options)) {
            return { status: 'no-op', revision: revision() };
          }
          const readingPosition = { page: action.page, location: 0 };
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
        },
      );
    },
    prepareShutdown() {
      if (shutdownPreparation) return shutdownPreparation;
      shutdownRequested = true;
      shutdownPreparation = enqueueDecision(async () => {
        try {
          await quiesce();
          // Runtime identity survives Save As; no Document is removed during preparation.
          for (const { runtime } of [...runtimes.values()]) {
            if (!(await decideUnsavedDocument(runtime))) {
              cancelShutdown();
              return false;
            }
          }
          if (!isShutdownPrepared()) {
            cancelShutdown();
            return false;
          }
          return true;
        } catch (error) {
          cancelShutdown();
          throw error;
        }
      });
      return shutdownPreparation;
    },
    isShutdownPrepared,
    cancelShutdown,
    captureRecoveryDraft,
    canonicalizeDocumentPaths,
    query(filePath) {
      const targetPath = filePath ?? session.snapshot().activeDocumentPath;
      if (!targetPath) return null;
      const registered = runtimes.get(targetPath);
      if (!registered) return null;
      const queryGeneration = registered.generation;
      return createDocumentQuery({
        filePath: targetPath,
        generation: queryGeneration,
        runtime: registered.runtime,
        isCurrent: () => {
          const current = runtimes.get(targetPath);
          return (
            current === registered &&
            registered.generation === queryGeneration &&
            runtimeGenerations.get(targetPath) === queryGeneration &&
            hasSessionDocument(targetPath) &&
            !isRemovalPending(targetPath)
          );
        },
      });
    },
    isDocumentOpen(filePath) {
      return hasSessionDocument(filePath) && runtimes.has(filePath) && !isRemovalPending(filePath);
    },
    snapshot: session.snapshot,
    observe: session.observe,
    quiesce,
    flush: session.flush,
    hasUnsavedPdfWork: () =>
      pendingReloads.size > 0 ||
      pendingSaves.size > 0 ||
      [...runtimes.values()].some(({ runtime }) => runtime.editing?.state().dirty),
    hasDirtySession: session.isDirty,
  };
  return reader;
}
