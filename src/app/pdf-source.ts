import { invoke } from '@tauri-apps/api/core';
import type { DocumentMetadata, PdfSource } from '../reader/pdf-source';
import { bytesFromNativeResponse } from './native-bytes';

export type PdfSourceInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function parseDocumentMetadata(value: unknown): DocumentMetadata {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('canonicalPath' in value) ||
    typeof value.canonicalPath !== 'string' ||
    !('title' in value) ||
    typeof value.title !== 'string'
  ) {
    throw new Error('Invalid PDF source metadata response');
  }
  return { canonicalPath: value.canonicalPath, title: value.title };
}

export function createTauriPdfSource(
  invokeCommand: PdfSourceInvoke = (command, args) => invoke(command, args),
): PdfSource {
  return {
    async describe(requestedPath) {
      return parseDocumentMetadata(
        await invokeCommand('describe_pdf_file', { path: requestedPath }),
      );
    },
    async read(canonicalPath) {
      return bytesFromNativeResponse(
        await invokeCommand('read_pdf_file', { path: canonicalPath }),
        'Invalid PDF source byte response',
      );
    },
  };
}
