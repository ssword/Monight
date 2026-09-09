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
  setAnnotationDisplayName?(displayName: string): void;
}

export interface PdfSaveDestination {
  readonly token: string;
  readonly canonicalPath: string;
  readonly title: string;
}

export interface NativePdfSaveAdapter {
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
