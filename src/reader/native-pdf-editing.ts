/** Live PDF edits are independent of durable Reading Session persistence. */
export interface NativePdfEditing {
  state(): {
    readonly revision: number;
    readonly dirty: boolean;
    readonly readOnlyReason: string | null;
  };
  exportPdf(): Promise<Uint8Array>;
  markSaved(revision: number): void;
}

export interface PdfSaveDestination {
  readonly token: string;
  readonly canonicalPath: string;
  readonly title: string;
}

export interface NativePdfSaveAdapter {
  chooseDestination(title: string): Promise<PdfSaveDestination | null>;
  /** Writes exclusively, syncs, and reads the resulting file back from disk. */
  writeNew(
    destination: PdfSaveDestination,
    bytes: Uint8Array,
    original: Uint8Array,
  ): Promise<Uint8Array>;
  releaseDestination(destination: PdfSaveDestination): Promise<void>;
}
