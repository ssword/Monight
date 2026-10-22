import {
  PdfBlendMode,
  type PdfDocumentObject,
  type PdfEngine,
  type PdfPageObject,
} from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

interface DirectExecutor {
  pdfiumModule: WrappedPdfiumModule;
  cache: {
    getContext(id: string):
      | {
          acquirePage(index: number): { pagePtr: number; release(): void };
        }
      | undefined;
  };
  getAnnotationByName(pagePtr: number, id: string): number;
  memoryManager: { malloc(size: number): number; free(ptr: number): void };
}

/**
 * The pinned generator uses QuadPoints for /BBox but retains a padded /Rect.
 * Re-install its simple Underline/StrikeOut stream with FPDFAnnot_SetAP, whose
 * /BBox is the annotation Rect. Coordinates then map 1:1 in external readers.
 * This runs only after a genuine visual edit, never on an existing appearance.
 */
export function mapRegeneratedTextMarkupAppearance(
  engine: PdfEngine,
  document: PdfDocumentObject,
  page: PdfPageObject,
  annotationId: string,
): void {
  const executor = Reflect.get(engine, 'executor') as DirectExecutor | undefined;
  if (!executor?.pdfiumModule?.FPDFAnnot_SetAP || !executor.getAnnotationByName)
    throw new Error('Native text-markup appearance correction is unavailable');
  const context = executor.cache.getContext(document.id);
  if (!context) throw new Error('The Document is not open');
  const acquired = context.acquirePage(page.index);
  const pdfium = executor.pdfiumModule;
  const memory = executor.memoryManager;
  let annotation = 0;
  let buffer = 0;
  try {
    annotation = executor.getAnnotationByName(acquired.pagePtr, annotationId);
    if (!annotation) throw new Error('Native text markup was not found');
    if (pdfium.EPDFAnnot_GetBlendMode(annotation) !== PdfBlendMode.Normal)
      throw new Error('Regenerated text markup requires a supported Normal blend appearance');
    const length = pdfium.FPDFAnnot_GetAP(annotation, 0, 0, 0);
    if (length <= 2) throw new Error('Text-markup appearance generation failed');
    buffer = memory.malloc(length);
    pdfium.FPDFAnnot_GetAP(annotation, 0, buffer, length);
    // The generated strokes use only /GS (normal blend/annotation opacity).
    // SetAP recreates that resource when CA < 1; opaque strokes need no gs.
    const opacityPtr = memory.malloc(4);
    let opacity: number;
    try {
      if (!pdfium.EPDFAnnot_GetOpacity(annotation, opacityPtr))
        throw new Error('Native text-markup opacity could not be read');
      opacity = pdfium.pdfium.getValue(opacityPtr, 'i32');
    } finally {
      memory.free(opacityPtr);
    }
    let stream = pdfium.pdfium.UTF16ToString(buffer);
    if (opacity === 255) stream = stream.replace('/GS gs ', '');
    // Fail closed if a future engine introduces resources SetAP cannot retain.
    if (/\/(?!GS\b)[A-Za-z]/.test(stream))
      throw new Error('Unsupported regenerated text-markup appearance resources');
    pdfium.pdfium.stringToUTF16(stream, buffer, length);
    if (!pdfium.FPDFAnnot_SetAP(annotation, 0, buffer))
      throw new Error('Native text-markup appearance mapping failed');
  } finally {
    if (buffer) memory.free(buffer);
    if (annotation) pdfium.FPDFPage_CloseAnnot(annotation);
    acquired.release();
  }
}
