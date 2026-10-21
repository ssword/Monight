declare const annotationDisplayNameBrand: unique symbol;

export type AnnotationDisplayName = string & {
  readonly [annotationDisplayNameBrand]: true;
};

export const DEFAULT_ANNOTATION_DISPLAY_NAME = 'Guest' as AnnotationDisplayName;

export function normalizeAnnotationDisplayName(value: unknown): AnnotationDisplayName {
  return (
    typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_ANNOTATION_DISPLAY_NAME
  ) as AnnotationDisplayName;
}

export type PageRotationDirection = 'clockwise' | 'counterclockwise';

/** Live PDF edits are independent of durable Reading Session persistence. */
export interface NativePdfEditing {
  state(): {
    readonly revision: number;
    readonly dirty: boolean;
    readonly readOnlyReason: string | null;
  };
  exportPdf(): Promise<Uint8Array>;
  markSaved(revision: number): void;
  markRecovered?(revision: number): void;
  setAnnotationDisplayName?(displayName: AnnotationDisplayName): void;
  /**
   * Turns the Page Rotation stored in the PDF of each 1-based page by a quarter turn, as
   * one edit on the same undo timeline as Annotation edits.
   */
  rotatePages?(pages: readonly number[], direction: PageRotationDirection): void;
  /** Undoes the most recent edit (Annotation or Page Rotation). */
  undo?(): void;
  /** Reapplies the most recently undone edit. */
  redo?(): void;
}

export interface PdfSaveDestination {
  readonly token: string;
  readonly canonicalPath: string;
  readonly title: string;
}

export interface NativePdfSaveAdapter {
  /** Normalizes native annotation bookkeeping before exact-byte write verification. */
  prepareBytes?(bytes: Uint8Array): Promise<Uint8Array>;
  captureSource?(filePath: string, bytes: Uint8Array): Promise<string>;
  releaseSource?(token: string): Promise<void>;
  readSource?(filePath: string): Promise<Uint8Array>;
  writeOriginal?(token: string, bytes: Uint8Array): Promise<Uint8Array>;
  chooseDestination(title: string): Promise<PdfSaveDestination | null>;
  /** Writes a selected destination with version checks, then reads it back from disk. */
  writeDestination(
    destination: PdfSaveDestination,
    bytes: Uint8Array,
    sourceToken: string,
  ): Promise<Uint8Array>;
  releaseDestination(destination: PdfSaveDestination): Promise<void>;
}
