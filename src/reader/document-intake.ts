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
  restoredDocument?: ReadingSessionDocument;
}

export interface DocumentRuntimeIntake {
  isOpen(filePath: string): boolean;
  activate(filePath: string, options?: DocumentRuntimeActivateOptions): Promise<void>;
  open(request: DocumentRuntimeOpenRequest): Promise<void>;
  goToPage(filePath: string, page: number): Promise<void>;
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
  opened: number;
  failed: number;
  failedPaths: string[];
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
  readonly foregroundDocumentPath?: string | null;
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

export function createDocumentIntake({
  source,
  runtime,
  coordinator = createDocumentIntakeCoordinator(),
  onSucceeded,
  onObserverError = (error) => console.error('Document Intake observer failed:', error),
}: DocumentIntakeOptions): DocumentIntake {
  const begin = (
    paths: readonly string[],
    options: OpenDocumentsOptions = {},
  ): DocumentIntakeOperation => {
    let resolveForeground!: (outcome: DocumentIntakeOutcome | null) => void;
    const foreground = new Promise<DocumentIntakeOutcome | null>((resolve) => {
      resolveForeground = resolve;
    });
    if (paths.length === 0) resolveForeground(null);

    const completion = (async () => {
      const outcomes: DocumentIntakeOutcome[] = [];
      for (const [index, requestedPath] of paths.entries()) {
        try {
          const document = await source.describe(requestedPath);
          let outcome: Extract<DocumentIntakeOutcome, { status: 'opened' | 'activated' }>;
          const preparation = await coordinator.prepare(
            document.canonicalPath,
            () => runtime.isOpen(document.canonicalPath),
            async () => {
              const bytes = await source.read(document.canonicalPath);
              await runtime.open({
                document,
                bytes,
                activate: options.activate !== false,
                ...(index === 0 && options.page !== undefined ? { initialPage: options.page } : {}),
              });
            },
          );
          if (preparation === 'existing') {
            if (options.activate !== false) await runtime.activate(document.canonicalPath);
            if (index === 0 && options.page !== undefined) {
              await runtime.goToPage(document.canonicalPath, options.page);
            }
            outcome = {
              status: 'activated',
              requestedPath,
              filePath: document.canonicalPath,
            };
          } else {
            outcome = { status: 'opened', requestedPath, filePath: document.canonicalPath };
          }
          outcomes.push(outcome);
          if (index === 0) resolveForeground(outcome);
          try {
            onSucceeded?.(outcome);
          } catch (error) {
            onObserverError(error);
          }
        } catch (error) {
          const outcome: DocumentIntakeOutcome = { status: 'failed', requestedPath, error };
          outcomes.push(outcome);
          if (index === 0) resolveForeground(outcome);
        }
      }

      return {
        outcomes,
        opened: outcomes.filter(({ status }) => status === 'opened').length,
        activated: outcomes.filter(({ status }) => status === 'activated').length,
        failed: outcomes.filter(({ status }) => status === 'failed').length,
      };
    })();

    return { foreground, completion };
  };

  const restore = async (
    session: PersistedReadingSession,
    { foregroundDocumentPath }: RestoreReadingSessionOptions = {},
  ): Promise<RestoreSessionResult> => {
    if (!runtime.canonicalizeDocumentPaths || !runtime.setDocumentOrder) {
      throw new Error('Document Intake runtime cannot restore the Reading Session');
    }

    let opened = 0;
    let failed = 0;
    const failedPaths: string[] = [];
    const canonicalPaths = new Map<string, string>();
    const runtimeStateSources = new Set<string>();
    const availablePaths = new Set<string>();
    let foregroundWasOpen = foregroundDocumentPath ? runtime.isOpen(foregroundDocumentPath) : false;
    const savedActive = session.documents.find(
      (document) => document.filePath === session.activeDocumentPath,
    );
    const restoreOrder = savedActive
      ? [savedActive, ...session.documents.filter((document) => document !== savedActive)]
      : session.documents;

    for (const document of restoreOrder) {
      try {
        const described = await source.describe(document.filePath);
        if (
          foregroundDocumentPath === document.filePath &&
          runtime.isOpen(described.canonicalPath)
        ) {
          foregroundWasOpen = true;
        }
        const preparation = await coordinator.prepare(
          described.canonicalPath,
          () => runtime.isOpen(described.canonicalPath),
          async () => {
            const bytes = await source.read(described.canonicalPath);
            await runtime.open({
              document: described,
              bytes,
              activate: false,
              restoredDocument: { ...document, filePath: described.canonicalPath },
            });
          },
        );
        canonicalPaths.set(document.filePath, described.canonicalPath);
        if (preparation === 'opened') runtimeStateSources.add(document.filePath);
        opened += 1;
        availablePaths.add(described.canonicalPath);
      } catch {
        // Treat per-Document open failures as isolated restore failures so the remaining
        // Documents still restore and the corrected Reading Session can be pruned deterministically.
        failed += 1;
        failedPaths.push(document.filePath);
      }
    }

    const pathMappings = Array.from(canonicalPaths, ([requestedPath, canonicalPath]) => ({
      requestedPath,
      canonicalPath,
      runtimeStateSource: runtimeStateSources.has(requestedPath)
        ? ('requested' as const)
        : ('canonical' as const),
    }));
    await runtime.canonicalizeDocumentPaths(pathMappings);
    runtime.setDocumentOrder(
      Array.from(
        new Set(
          session.documents.map(
            (document) => canonicalPaths.get(document.filePath) ?? document.filePath,
          ),
        ),
      ),
    );

    const requestedActivationPath = foregroundDocumentPath ?? session.activeDocumentPath;
    const activationPath = requestedActivationPath
      ? (canonicalPaths.get(requestedActivationPath) ?? requestedActivationPath)
      : null;
    if (activationPath && !foregroundWasOpen && availablePaths.has(activationPath)) {
      await runtime.activate(activationPath, { notifyOpened: false });
    }

    return { opened, failed, failedPaths };
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
