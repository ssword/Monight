import type { ViewMode } from '../lib/document-features';
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

/** Live presentation only. PDF-authored page orientation belongs to Document
 * Content and is never included in viewingRotation. Save and print must use
 * Document Content, without applying this transform to PDF bytes. */
export interface DocumentViewTransform {
  readonly scale: number;
  readonly zoomIntent: ZoomIntent;
  readonly viewingRotation: number;
  readonly viewMode: ViewMode;
  readonly filterCss: string;
}

export interface DocumentRendering {
  getState(): DocumentRenderingState;
  openSearch?(): void;
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
  destroy(): void;
}
