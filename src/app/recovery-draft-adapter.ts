import { invoke } from '@tauri-apps/api/core';
import type { RecoveryDraftAdapter, RecoveryDraftInspection } from '../reader/recovery-drafts';

interface NativeDraftMetadata {
  readonly documentPath: string;
  readonly sourceVersion: string;
  readonly editedRevision: number;
}

type NativeDraftInspection =
  | { readonly status: 'none'; readonly sourceVersion: string }
  | { readonly status: 'protected' }
  | { readonly status: 'stale'; readonly sourceVersion: string }
  | {
      readonly status: 'available';
      readonly sourceVersion: string;
      readonly draft: NativeDraftMetadata;
    };

const asBytes = (response: ArrayBuffer): Uint8Array => {
  if (!(response instanceof ArrayBuffer)) throw new Error('Invalid Recovery Draft response');
  return new Uint8Array(response);
};

export const nativeRecoveryDraftAdapter: RecoveryDraftAdapter = {
  async inspect(documentPath, sourceBytes): Promise<RecoveryDraftInspection> {
    const inspection = await invoke<NativeDraftInspection>('inspect_recovery_draft', {
      documentPath,
      sourceBytes: Array.from(sourceBytes),
    });
    if (inspection.status !== 'available') return inspection;
    const response = await invoke<ArrayBuffer>('read_recovery_draft', {
      documentPath,
      sourceVersion: inspection.sourceVersion,
      editedRevision: inspection.draft.editedRevision,
    });
    return {
      ...inspection,
      draft: { ...inspection.draft, bytes: asBytes(response) },
    };
  },
  write: (draft) =>
    invoke('write_recovery_draft', {
      draft: { ...draft, bytes: Array.from(draft.bytes) },
    }),
  repairAfterWrite: async (repair) =>
    invoke('repair_recovery_draft_after_write', {
      repair: {
        ...repair,
        sourceBytes: Array.from(repair.sourceBytes),
        draftBytes: Array.from(repair.draftBytes),
      },
    }),
  reconcile: async (reconciliation) =>
    invoke('reconcile_recovery_draft', {
      reconciliation: {
        ...reconciliation,
        sourceBytes: Array.from(reconciliation.sourceBytes),
      },
    }),
  remove: (documentPath) => invoke('remove_recovery_draft', { documentPath }),
};
