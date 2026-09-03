export interface DocumentMetadata {
  readonly canonicalPath: string;
  readonly title: string;
}

export interface PdfSource {
  describe(requestedPath: string): Promise<DocumentMetadata>;
  read(canonicalPath: string): Promise<Uint8Array>;
}

export interface DocumentRuntimeIntake {
  isOpen(filePath: string): boolean;
  activate(filePath: string): Promise<void>;
  open(document: DocumentMetadata, bytes: Uint8Array): Promise<void>;
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

interface DocumentIntakeOptions {
  source: PdfSource;
  runtime: DocumentRuntimeIntake;
  onSucceeded?: (
    outcome: Extract<DocumentIntakeOutcome, { status: 'opened' | 'activated' }>,
  ) => void;
  onObserverError?: (error: unknown) => void;
}

export interface OpenDocumentsOptions {
  readonly page?: number;
}

export interface DocumentIntake {
  open(paths: readonly string[], options?: OpenDocumentsOptions): Promise<DocumentIntakeResult>;
}

export function createDocumentIntake({
  source,
  runtime,
  onSucceeded,
  onObserverError = (error) => console.error('Document Intake observer failed:', error),
}: DocumentIntakeOptions): DocumentIntake {
  return {
    async open(paths, options = {}) {
      const outcomes: DocumentIntakeOutcome[] = [];
      for (const [index, requestedPath] of paths.entries()) {
        try {
          const document = await source.describe(requestedPath);
          let outcome: Extract<DocumentIntakeOutcome, { status: 'opened' | 'activated' }>;
          if (runtime.isOpen(document.canonicalPath)) {
            await runtime.activate(document.canonicalPath);
            if (index === 0 && options.page !== undefined) {
              await runtime.goToPage(document.canonicalPath, options.page);
            }
            outcome = {
              status: 'activated',
              requestedPath,
              filePath: document.canonicalPath,
            };
          } else {
            const bytes = await source.read(document.canonicalPath);
            await runtime.open(document, bytes);
            if (index === 0 && options.page !== undefined) {
              await runtime.goToPage(document.canonicalPath, options.page);
            }
            outcome = { status: 'opened', requestedPath, filePath: document.canonicalPath };
          }
          outcomes.push(outcome);
          try {
            onSucceeded?.(outcome);
          } catch (error) {
            onObserverError(error);
          }
        } catch (error) {
          outcomes.push({ status: 'failed', requestedPath, error });
        }
      }

      return {
        outcomes,
        opened: outcomes.filter(({ status }) => status === 'opened').length,
        activated: outcomes.filter(({ status }) => status === 'activated').length,
        failed: outcomes.filter(({ status }) => status === 'failed').length,
      };
    },
  };
}
