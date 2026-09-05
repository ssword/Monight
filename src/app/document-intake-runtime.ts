import {
  createDocumentIntake,
  type DocumentIntake,
  type DocumentRuntimeIntake,
} from '../reader/document-intake';
import type { PdfSource } from '../reader/pdf-source';
import type { DocumentPathReconciliation } from '../reader/reading-session';
import { createTauriPdfSource } from './pdf-source';

interface CreateDocumentIntakeRuntimeOptions {
  runtime: DocumentRuntimeIntake;
  source?: PdfSource;
  canonicalizeDocumentPaths?: (paths: readonly DocumentPathReconciliation[]) => Promise<void>;
}

export function createDocumentIntakeRuntime({
  runtime,
  source = createTauriPdfSource(),
  canonicalizeDocumentPaths,
}: CreateDocumentIntakeRuntimeOptions): DocumentIntake {
  return createDocumentIntake({
    source,
    runtime: canonicalizeDocumentPaths ? { ...runtime, canonicalizeDocumentPaths } : runtime,
  });
}
