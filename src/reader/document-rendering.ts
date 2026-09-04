import type {
  PdfAnnotation,
  PdfAnnotationColor,
  PdfSearchMatch,
  ViewMode,
} from '../lib/document-features';
import type {
  ReaderActionOptions,
  ReadingPosition,
  RestorableReadingPosition,
  ZoomIntent,
} from './reader-actions';

export interface DocumentRenderingState {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly zoom: number;
  readonly zoomIntent: ZoomIntent;
  readonly rotation: number;
  readonly fileName: string;
  readonly filePath: string;
  readonly viewMode: ViewMode;
}

export interface DocumentRendering {
  getState(): DocumentRenderingState;
  getScrollPosition(): number;
  getReadingPosition(): ReadingPosition;
  goToPage(pageNumber: number, options?: ReaderActionOptions): Promise<void>;
  goToReadingPosition(
    position: RestorableReadingPosition,
    options?: ReaderActionOptions,
  ): Promise<void>;
  setZoomIntent(intent: ZoomIntent, options?: ReaderActionOptions): Promise<void>;
  zoomIn(options?: ReaderActionOptions): Promise<void>;
  zoomOut(options?: ReaderActionOptions): Promise<void>;
  setRotation(rotation: number, options?: ReaderActionOptions): Promise<void>;
  setViewMode(viewMode: ViewMode, options?: ReaderActionOptions): Promise<void>;
  fitToPage(options?: ReaderActionOptions): Promise<void>;
  applyFilter(filterCss: string, options?: ReaderActionOptions): void;
  setVisible(visible: boolean): void;
  revealSearchMatch(match: PdfSearchMatch): Promise<void>;
  setSearchQuery(query: string): void;
  clearSearch(): void;
  setAnnotations(annotations: readonly PdfAnnotation[]): void;
  addPageNote(note: string): Promise<void>;
  updateAnnotation(
    annotationId: string,
    updates: { note?: string; color?: PdfAnnotationColor },
  ): void;
  removeAnnotation(annotationId: string): void;
  print(): Promise<void>;
  destroy(): void;
}
