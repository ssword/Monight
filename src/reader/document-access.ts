import type { PdfAnnotationColor, PdfSearchMatch } from '../lib/document-features';
import type { DocumentQuery } from './document-queries';
import type { DocumentRenderingState } from './document-rendering';

export interface DocumentPresentation {
  snapshot(): DocumentRenderingState;
  setSearchQuery(query: string): void;
  clearSearch(): void;
  revealSearchMatch(match: PdfSearchMatch): Promise<void>;
  addPageNote(note: string): Promise<void>;
  updateAnnotation(
    annotationId: string,
    updates: { note?: string; color?: PdfAnnotationColor },
  ): void;
  removeAnnotation(annotationId: string): void;
}

export interface DocumentAccess {
  readonly query: DocumentQuery;
  readonly presentation: DocumentPresentation;
}
