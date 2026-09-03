import type { DocumentMetadata, PdfSource } from './pdf-source';
import type { PersistedReadingSession, ReadingSessionDocument } from './reader-actions';

export type { DocumentMetadata, PdfSource } from './pdf-source';

export type RestoreDocumentResult = { status: 'restored' } | { status: 'failed'; message: string };

export interface DocumentRuntimeIntake {
  isOpen(filePath: string): boolean;
  activate(filePath: string): Promise<void>;
  open(
    document: DocumentMetadata,
    bytes: Uint8Array,
    activate: boolean,
    initialPage?: number,
  ): Promise<void>;
  goToPage(filePath: string, page: number): Promise<void>;
  restoreDocumentState?(
    document: ReadingSessionDocument,
    options: { preserveCurrentReadingPosition: boolean },
  ): Promise<RestoreDocumentResult>;
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
  readonly preserveForegroundReadingPosition?: boolean;
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
              await runtime.open(
                document,
                bytes,
                options.activate !== false,
                index === 0 ? options.page : undefined,
              );
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
    {
      foregroundDocumentPath,
      preserveForegroundReadingPosition = false,
    }: RestoreReadingSessionOptions = {},
  ): Promise<RestoreSessionResult> => {
    if (!runtime.restoreDocumentState || !runtime.setDocumentOrder) {
      throw new Error('Document Intake runtime cannot restore the Reading Session');
    }

    let opened = 0;
    let failed = 0;
    const failedPaths: string[] = [];
    const savedActive = session.documents.find(
      (document) => document.filePath === session.activeDocumentPath,
    );
    const activationAnchorPath = foregroundDocumentPath ?? session.activeDocumentPath;
    const restoreOrder = savedActive
      ? [savedActive, ...session.documents.filter((document) => document !== savedActive)]
      : session.documents;

    for (const document of restoreOrder) {
      const result = await open([document.filePath], {
        activate: document.filePath === activationAnchorPath,
      });
      const outcome = result.outcomes[0];
      if (!outcome || outcome.status === 'failed') {
        failed += 1;
        failedPaths.push(document.filePath);
        continue;
      }

      try {
        const restoreOutcome = await runtime.restoreDocumentState(document, {
          preserveCurrentReadingPosition:
            preserveForegroundReadingPosition && document.filePath === foregroundDocumentPath,
        });
        if (restoreOutcome.status === 'restored') {
          opened += 1;
          continue;
        }
      } catch {
        // Treat adapter restore failures as per-Document failures so the remaining Documents
        // still restore and the corrected Reading Session can be pruned deterministically.
      }

      failed += 1;
      failedPaths.push(document.filePath);
    }

    runtime.setDocumentOrder(session.documents.map((document) => document.filePath));

    if (activationAnchorPath) await runtime.activate(activationAnchorPath);

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
