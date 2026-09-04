import type { DocumentMetadata, PdfSource } from './pdf-source';
import type { PersistedReadingSession, ReadingSessionDocument } from './reader-actions';
import type { DocumentPathReconciliation } from './reading-session';

export type { DocumentMetadata, PdfSource } from './pdf-source';

export interface DocumentRuntimeActivateOptions {
  notifyOpened?: boolean;
}

export interface DocumentRuntimeOpenRequest {
  document: DocumentMetadata;
  bytes: Uint8Array;
  activate: boolean;
  initialPage?: number;
  notifyOpened?: boolean;
  restoredDocument?: ReadingSessionDocument;
}

export interface DocumentRuntimeIntake {
  isOpen(filePath: string): boolean;
  activate(filePath: string, options?: DocumentRuntimeActivateOptions): Promise<void>;
  notifyOpened?(filePath: string): Promise<void>;
  open(request: DocumentRuntimeOpenRequest): Promise<void>;
  goToPage(filePath: string, page: number): Promise<void>;
  restoreExistingDocument?(
    filePath: string,
    document: ReadingSessionDocument,
    options: { preserveReadingPosition: boolean },
  ): Promise<ReadingSessionDocument>;
  canonicalizeDocumentPaths?(paths: readonly DocumentPathReconciliation[]): Promise<void>;
  setDocumentOrder?(filePaths: readonly string[]): void;
}

export type DocumentIntakeOutcome =
  | { status: 'opened'; requestedPath: string; filePath: string }
  | { status: 'activated'; requestedPath: string; filePath: string }
  | { status: 'failed'; requestedPath: string; error: unknown };

export interface DocumentIntakeResult {
  readonly outcomes: readonly DocumentIntakeOutcome[];
  readonly opened: number;
  readonly activated: number;
  readonly failed: number;
}

export interface RestoreSessionResult {
  readonly outcomes: readonly DocumentIntakeOutcome[];
  readonly opened: number;
  readonly failed: number;
  readonly failedPaths: readonly string[];
  readonly explicitRequestResult: DocumentIntakeResult;
}

type DocumentPreparationResult = 'opened' | 'existing';

export interface DocumentIntakeCoordinator {
  prepare(
    canonicalPath: string,
    isOpen: () => boolean,
    open: () => Promise<void>,
  ): Promise<DocumentPreparationResult>;
}

export function createDocumentIntakeCoordinator(): DocumentIntakeCoordinator {
  const pending = new Map<string, Promise<void>>();

  return {
    async prepare(canonicalPath, isOpen, open) {
      const existingPreparation = pending.get(canonicalPath);
      if (existingPreparation) {
        await existingPreparation;
        return 'existing';
      }
      if (isOpen()) return 'existing';

      const preparation = Promise.resolve().then(open);
      pending.set(canonicalPath, preparation);
      try {
        await preparation;
        return 'opened';
      } finally {
        if (pending.get(canonicalPath) === preparation) pending.delete(canonicalPath);
      }
    },
  };
}

interface DocumentIntakeOptions {
  source: PdfSource;
  runtime: DocumentRuntimeIntake;
  coordinator?: DocumentIntakeCoordinator;
  onSucceeded?: (
    outcome: Extract<DocumentIntakeOutcome, { status: 'opened' | 'activated' }>,
  ) => void;
  onObserverError?: (error: unknown) => void;
}

export interface OpenDocumentsOptions {
  readonly page?: number;
  readonly activate?: boolean;
}

export interface RestoreReadingSessionOptions {
  readonly explicitRequests?: readonly StartupDocumentRequest[];
  readonly onForegroundReady?: (outcome: DocumentIntakeOutcome) => void | Promise<void>;
}

export interface StartupDocumentRequest {
  readonly paths: readonly string[];
  readonly page?: number;
}

export interface DocumentIntake {
  begin(paths: readonly string[], options?: OpenDocumentsOptions): DocumentIntakeOperation;
  open(paths: readonly string[], options?: OpenDocumentsOptions): Promise<DocumentIntakeResult>;
  restore(
    session: PersistedReadingSession,
    options?: RestoreReadingSessionOptions,
  ): Promise<RestoreSessionResult>;
}

export interface DocumentIntakeOperation {
  readonly foreground: Promise<DocumentIntakeOutcome | null>;
  readonly completion: Promise<DocumentIntakeResult>;
}

type DocumentIntakeOrigin = 'explicit' | 'restoration';

interface ForegroundSignal {
  readonly promise: Promise<DocumentIntakeOutcome | null>;
  resolve(outcome: DocumentIntakeOutcome | null): void;
}

function createForegroundSignal(): ForegroundSignal {
  let resolvePromise!: (outcome: DocumentIntakeOutcome | null) => void;
  let resolved = false;
  const promise = new Promise<DocumentIntakeOutcome | null>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(outcome) {
      if (resolved) return;
      resolved = true;
      resolvePromise(outcome);
    },
  };
}

export function createDocumentIntake({
  source,
  runtime,
  coordinator = createDocumentIntakeCoordinator(),
  onSucceeded,
  onObserverError = (error) => console.error('Document Intake observer failed:', error),
}: DocumentIntakeOptions): DocumentIntake {
  const summarizeOutcomes = (outcomes: readonly DocumentIntakeOutcome[]): DocumentIntakeResult => ({
    outcomes,
    opened: outcomes.filter(({ status }) => status === 'opened').length,
    activated: outcomes.filter(({ status }) => status === 'activated').length,
    failed: outcomes.filter(({ status }) => status === 'failed').length,
  });

  const intakeDescribedDocument = async (
    requestedPath: string,
    document: DocumentMetadata,
    {
      activate,
      initialPage,
      origin,
      restoredDocument,
    }: {
      activate: boolean;
      initialPage?: number;
      origin: DocumentIntakeOrigin;
      restoredDocument?: ReadingSessionDocument;
    },
  ): Promise<{
    outcome: Extract<DocumentIntakeOutcome, { status: 'opened' | 'activated' }>;
    preparation: DocumentPreparationResult;
  }> => {
    const notifyOpened = origin === 'explicit';
    const preparation = await coordinator.prepare(
      document.canonicalPath,
      () => runtime.isOpen(document.canonicalPath),
      async () => {
        const bytes = await source.read(document.canonicalPath);
        await runtime.open({
          document,
          bytes,
          activate,
          ...(initialPage !== undefined ? { initialPage } : {}),
          notifyOpened,
          ...(restoredDocument ? { restoredDocument } : {}),
        });
      },
    );
    if (preparation === 'existing') {
      if (activate) {
        if (notifyOpened === false) {
          await runtime.activate(document.canonicalPath, { notifyOpened: false });
        } else {
          await runtime.activate(document.canonicalPath);
        }
      } else if (notifyOpened) {
        await runtime.notifyOpened?.(document.canonicalPath);
      }
      if (initialPage !== undefined) {
        await runtime.goToPage(document.canonicalPath, initialPage);
      }
    }
    const outcome: Extract<DocumentIntakeOutcome, { status: 'opened' | 'activated' }> =
      preparation === 'opened'
        ? { status: 'opened', requestedPath, filePath: document.canonicalPath }
        : { status: 'activated', requestedPath, filePath: document.canonicalPath };
    if (notifyOpened) {
      try {
        onSucceeded?.(outcome);
      } catch (error) {
        onObserverError(error);
      }
    }
    return { outcome, preparation };
  };

  const begin = (
    paths: readonly string[],
    options: OpenDocumentsOptions = {},
  ): DocumentIntakeOperation => {
    const foreground = createForegroundSignal();
    if (paths.length === 0) foreground.resolve(null);

    const completion = (async () => {
      const outcomes: DocumentIntakeOutcome[] = [];
      let hasActivatedDocument = false;
      for (const [index, requestedPath] of paths.entries()) {
        try {
          const document = await source.describe(requestedPath);
          const activateDocument = options.activate !== false && !hasActivatedDocument;
          const { outcome } = await intakeDescribedDocument(requestedPath, document, {
            activate: activateDocument,
            ...(index === 0 && options.page !== undefined ? { initialPage: options.page } : {}),
            origin: 'explicit',
          });
          if (activateDocument) hasActivatedDocument = true;
          outcomes.push(outcome);
          if (index === 0) foreground.resolve(outcome);
        } catch (error) {
          const outcome: DocumentIntakeOutcome = { status: 'failed', requestedPath, error };
          outcomes.push(outcome);
          if (index === 0) foreground.resolve(outcome);
        }
      }

      return summarizeOutcomes(outcomes);
    })();

    return { foreground: foreground.promise, completion };
  };

  const restore = (
    session: PersistedReadingSession,
    { explicitRequests = [], onForegroundReady }: RestoreReadingSessionOptions = {},
  ): Promise<RestoreSessionResult> => {
    if (!runtime.canonicalizeDocumentPaths || !runtime.setDocumentOrder) {
      throw new Error('Document Intake runtime cannot restore the Reading Session');
    }
    const canonicalizeDocumentPaths = runtime.canonicalizeDocumentPaths;
    const setDocumentOrder = runtime.setDocumentOrder;

    const completion = (async () => {
      const canonicalPaths = new Map<string, string>();
      const runtimeStateSources = new Set<string>();
      const restoredStateOverrides = new Map<string, ReadingSessionDocument>();
      const handledSavedPaths = new Set<string>();
      const restoredOutcomes = new Map<string, DocumentIntakeOutcome>();
      const explicitOutcomes: DocumentIntakeOutcome[] = [];
      const explicitCanonicalPaths = new Set<string>();
      const explicitSavedStateSources = new Map<string, string>();
      const explicitPageOverrides = new Set<string>();
      let hasForegroundDocument = false;
      const savedActive = session.documents.find(
        (document) => document.filePath === session.activeDocumentPath,
      );
      const remainingSavedDocuments = session.documents.filter(
        (document) => document.filePath !== savedActive?.filePath,
      );
      const explicitEntries = explicitRequests.flatMap((request) =>
        request.paths.map((requestedPath, index) => ({
          requestedPath,
          ...(index === 0 && request.page !== undefined ? { initialPage: request.page } : {}),
        })),
      );

      const recordSavedOutcome = (
        document: ReadingSessionDocument,
        outcome: DocumentIntakeOutcome,
      ): void => {
        handledSavedPaths.add(document.filePath);
        restoredOutcomes.set(document.filePath, outcome);
      };

      const findSavedDocument = (
        requestedPath: string,
        described: DocumentMetadata,
      ): ReadingSessionDocument | undefined =>
        session.documents.find(
          (document) =>
            document.filePath === requestedPath || document.filePath === described.canonicalPath,
        );

      const processExplicitEntry = async (
        entry: (typeof explicitEntries)[number],
        activate: boolean,
      ): Promise<DocumentIntakeOutcome | null> => {
        let savedDocument = session.documents.find(
          (document) => document.filePath === entry.requestedPath,
        );
        try {
          const described = await source.describe(entry.requestedPath);
          savedDocument = findSavedDocument(entry.requestedPath, described);
          const restoredDocument = savedDocument
            ? {
                ...savedDocument,
                filePath: described.canonicalPath,
                ...(entry.initialPage !== undefined
                  ? { readingPosition: { page: entry.initialPage, location: 0 } }
                  : {}),
              }
            : undefined;
          const { outcome, preparation } = await intakeDescribedDocument(
            entry.requestedPath,
            described,
            {
              activate,
              ...(entry.initialPage !== undefined ? { initialPage: entry.initialPage } : {}),
              origin: 'explicit',
              ...(restoredDocument ? { restoredDocument } : {}),
            },
          );
          explicitOutcomes.push(outcome);
          explicitCanonicalPaths.add(described.canonicalPath);
          if (entry.initialPage !== undefined) {
            explicitPageOverrides.add(described.canonicalPath);
          }
          if (savedDocument) {
            canonicalPaths.set(savedDocument.filePath, described.canonicalPath);
            explicitSavedStateSources.set(described.canonicalPath, savedDocument.filePath);
            if (savedDocument.filePath !== described.canonicalPath) {
              restoredStateOverrides.set(
                savedDocument.filePath,
                restoredDocument as ReadingSessionDocument,
              );
            } else if (preparation === 'opened') {
              runtimeStateSources.add(savedDocument.filePath);
            }
            recordSavedOutcome(savedDocument, {
              ...outcome,
              requestedPath: savedDocument.filePath,
            });
          }
          return outcome;
        } catch (error) {
          explicitOutcomes.push({ status: 'failed', requestedPath: entry.requestedPath, error });
          if (savedDocument) {
            recordSavedOutcome(savedDocument, {
              status: 'failed',
              requestedPath: savedDocument.filePath,
              error,
            });
          }
          return null;
        }
      };

      const processSavedDocument = async (
        document: ReadingSessionDocument,
        activate: boolean,
      ): Promise<DocumentIntakeOutcome | null> => {
        try {
          const described = await source.describe(document.filePath);
          const restoredDocument = { ...document, filePath: described.canonicalPath };
          const { outcome, preparation } = await intakeDescribedDocument(
            document.filePath,
            described,
            {
              activate,
              origin: 'restoration',
              restoredDocument,
            },
          );
          canonicalPaths.set(document.filePath, described.canonicalPath);
          if (preparation === 'opened') {
            runtimeStateSources.add(document.filePath);
          } else if (
            explicitCanonicalPaths.has(described.canonicalPath) &&
            !explicitSavedStateSources.has(described.canonicalPath)
          ) {
            const mergedDocument = runtime.restoreExistingDocument
              ? await runtime.restoreExistingDocument(described.canonicalPath, restoredDocument, {
                  preserveReadingPosition: explicitPageOverrides.has(described.canonicalPath),
                })
              : restoredDocument;
            restoredStateOverrides.set(document.filePath, mergedDocument);
            explicitSavedStateSources.set(described.canonicalPath, document.filePath);
          }
          recordSavedOutcome(document, outcome);
          return outcome;
        } catch (error) {
          recordSavedOutcome(document, {
            status: 'failed',
            requestedPath: document.filePath,
            error,
          });
          return null;
        }
      };

      const handOffForegroundDocument = async (
        outcome: DocumentIntakeOutcome | null,
      ): Promise<void> => {
        if (!outcome || hasForegroundDocument) return;
        hasForegroundDocument = true;
        await onForegroundReady?.(outcome);
      };

      for (const entry of explicitEntries) {
        const outcome = await processExplicitEntry(entry, !hasForegroundDocument);
        await handOffForegroundDocument(outcome);
      }

      if (savedActive && !handledSavedPaths.has(savedActive.filePath)) {
        const outcome = await processSavedDocument(savedActive, !hasForegroundDocument);
        await handOffForegroundDocument(outcome);
      }

      for (const document of remainingSavedDocuments) {
        if (handledSavedPaths.has(document.filePath)) continue;
        const outcome = await processSavedDocument(document, !hasForegroundDocument);
        await handOffForegroundDocument(outcome);
      }

      const pathMappings = Array.from(canonicalPaths, ([requestedPath, canonicalPath]) => {
        const document = restoredStateOverrides.get(requestedPath);
        return {
          requestedPath,
          canonicalPath,
          runtimeStateSource: runtimeStateSources.has(requestedPath)
            ? ('requested' as const)
            : ('canonical' as const),
          ...(document ? { document } : {}),
        };
      });
      await canonicalizeDocumentPaths(pathMappings);
      setDocumentOrder(
        Array.from(
          new Set(
            session.documents.map(
              (document) => canonicalPaths.get(document.filePath) ?? document.filePath,
            ),
          ),
        ),
      );

      const outcomes = session.documents.flatMap((document) => {
        const outcome = restoredOutcomes.get(document.filePath);
        return outcome ? [outcome] : [];
      });
      const failedPaths = outcomes.flatMap((outcome) =>
        outcome.status === 'failed' ? [outcome.requestedPath] : [],
      );
      return {
        outcomes,
        opened: outcomes.length - failedPaths.length,
        failed: failedPaths.length,
        failedPaths,
        explicitRequestResult: summarizeOutcomes(explicitOutcomes),
      };
    })();

    return completion;
  };

  const open = (
    paths: readonly string[],
    options?: OpenDocumentsOptions,
  ): Promise<DocumentIntakeResult> => begin(paths, options).completion;

  return {
    begin,
    open,
    restore,
  };
}
