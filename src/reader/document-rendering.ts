import type { ViewMode } from '../lib/document-features';
import type { DocumentAnnotationKind } from './document-queries';
import type {
  ReaderActionOptions,
  ReadingPosition,
  RestorableReadingPosition,
  ZoomIntent,
} from './reader-actions';

export interface DocumentRenderingState {
  readonly currentPage: number;
  readonly totalPages: number;
  /**
   * Each page's Page Rotation (quarter turns) from Document Content, in page
   * order; it changes when a Page Rotation or its undo applies. Absent when unknown.
   */
  readonly pageRotations?: readonly number[];
  readonly zoom: number;
  readonly zoomIntent: ZoomIntent;
  readonly fileName: string;
  readonly filePath: string;
  readonly viewMode: ViewMode;
}

/** Live presentation only. Page Rotation belongs to Document Content and is
 * never part of this transform. Save and print must use Document Content,
 * without applying this transform to PDF bytes. */
export interface DocumentViewTransform {
  readonly scale: number;
  readonly zoomIntent: ZoomIntent;
  readonly viewMode: ViewMode;
  readonly filterCss: string;
}

/** Appearance a markup tool gives the Annotations it creates. */
export interface AnnotationToolDefaults {
  readonly strokeColor?: string;
}

/** Where an Annotation sits in the window, in CSS pixels. */
export interface AnnotationAnchor {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The Annotation selected on an editable Document's surface (transient rendering state). */
export interface SelectedAnnotation {
  readonly id: string;
  readonly kind: DocumentAnnotationKind;
  /** The Annotation's note (its PDF Contents). */
  readonly contents: string;
  readonly color: string | null;
  /** Null while the Annotation is scrolled out of view. */
  readonly anchor: AnnotationAnchor | null;
}

export interface DocumentRendering {
  getState(): DocumentRenderingState;
  /** The transient annotation tool in use, or null for text selection. */
  activeAnnotationTool?(): string | null;
  /** Chooses an annotation tool, or null for text selection; refused while editing is unavailable. */
  setActiveAnnotationTool?(toolId: string | null, defaults?: AnnotationToolDefaults): void;
  /**
   * Marks the current text selection with a text-markup tool as an unsaved
   * Annotation edit; false when nothing is selected or editing is unavailable.
   */
  markupSelection?(toolId: string, defaults: AnnotationToolDefaults): boolean;
  /** Selects an Annotation already scrolled into view; transient rendering state. */
  revealAnnotation?(annotationId: string): void;
  /** The selected Annotation; null when none is selected or editing is unavailable. */
  selectedAnnotation?(): SelectedAnnotation | null;
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
  setViewMode(viewMode: ViewMode, options?: ReaderActionOptions): Promise<void>;
  fitToPage(options?: ReaderActionOptions): Promise<void>;
  applyFilter(filterCss: string, options?: ReaderActionOptions): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}
