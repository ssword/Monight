import type { DocumentMetadata, PdfSource } from './pdf-source';

export type { DocumentMetadata, PdfSource } from './pdf-source';

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

export interface DocumentIntake {
  begin(paths: readonly string[], options?: OpenDocumentsOptions): DocumentIntakeOperation;
  open(paths: readonly string[], options?: OpenDocumentsOptions): Promise<DocumentIntakeResult>;
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

  return {
    begin,
    open: (paths, options) => begin(paths, options).completion,
  };
}
