export interface RecoveryDraft {
  readonly documentPath: string;
  readonly sourceVersion: string;
  readonly editedRevision: number;
  readonly bytes: Uint8Array;
}

export type RecoveryDraftInspection =
  | { readonly status: 'none'; readonly sourceVersion: string }
  | { readonly status: 'protected' }
  | { readonly status: 'stale'; readonly sourceVersion: string }
  | {
      readonly status: 'available';
      readonly sourceVersion: string;
      readonly draft: RecoveryDraft;
    };

export interface RecoveryDraftReconciliation {
  readonly previousDocumentPath: string;
  readonly documentPath: string;
  readonly persistedRevision: number;
  readonly sourceBytes: Uint8Array;
}

export interface RecoveryDraftRepair {
  readonly documentPath: string;
  readonly sourceBytes: Uint8Array;
  readonly editedRevision: number;
  readonly draftBytes: Uint8Array;
}

/** Local crash recovery only; the original PDF remains the Annotation authority. */
export interface RecoveryDraftAdapter {
  inspect(documentPath: string, sourceBytes: Uint8Array): Promise<RecoveryDraftInspection>;
  write(draft: RecoveryDraft): Promise<void>;
  repairAfterWrite?(repair: RecoveryDraftRepair): Promise<{ sourceVersion: string }>;
  reconcile(reconciliation: RecoveryDraftReconciliation): Promise<{ sourceVersion: string }>;
  remove(documentPath: string): Promise<void>;
}

export type RecoveryDraftChoice = 'recover' | 'discard' | 'cancel';

export interface RecoveryDraftRequest {
  readonly documentPath: string;
  readonly title: string;
  readonly editedRevision: number;
  readonly signal?: AbortSignal;
}
