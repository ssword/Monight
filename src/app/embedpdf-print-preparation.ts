import { type PdfDocumentObject, type PdfEngine, PdfPermissionFlag } from '@embedpdf/models';
import type { NativePdfEditing } from '../reader/native-pdf-editing';

export async function prepareEmbedPdfPrintDocument({
  document,
  editing,
  engine,
  readOnlyReason,
}: {
  document: PdfDocumentObject;
  editing: NativePdfEditing;
  engine: PdfEngine;
  readOnlyReason: string | null;
}): Promise<Uint8Array> {
  if ((document.permissions & PdfPermissionFlag.Print) === 0) {
    throw new Error('Document permissions prohibit printing');
  }
  if (!readOnlyReason) return editing.exportPdf();
  const buffer = await engine
    .preparePrintDocument(document, { includeAnnotations: true })
    .toPromise();
  return new Uint8Array(buffer);
}
