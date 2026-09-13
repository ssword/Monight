import { invoke } from '@tauri-apps/api/core';
import type { DocumentMetadata, PdfSource } from '../reader/pdf-source';

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
      const response = await invokeCommand('read_pdf_file', { path: canonicalPath });
      if (Object.prototype.toString.call(response) === '[object ArrayBuffer]') {
        return new Uint8Array(response as ArrayBuffer).slice();
      }
      if (ArrayBuffer.isView(response)) {
        return new Uint8Array(response.buffer, response.byteOffset, response.byteLength).slice();
      }
      if (
        Array.isArray(response) &&
        response.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
      ) {
        return Uint8Array.from(response);
      }
      throw new Error('Invalid PDF source byte response');
    },
  };
}
