import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeRecoveryDraftAdapter } from '../app/recovery-draft-adapter';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('native Recovery Draft adapter', () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it('loads available bytes only after native identity and source-version inspection', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        status: 'available',
        sourceVersion: 'source-v1',
        draft: {
          documentPath: '/docs/report.pdf',
          sourceVersion: 'source-v1',
          editedRevision: 3,
        },
      })
      .mockResolvedValueOnce(new Uint8Array([7, 8]).buffer);

    await expect(
      nativeRecoveryDraftAdapter.inspect('/docs/report.pdf', new Uint8Array([1, 2])),
    ).resolves.toEqual({
      status: 'available',
      sourceVersion: 'source-v1',
      draft: {
        documentPath: '/docs/report.pdf',
        sourceVersion: 'source-v1',
        editedRevision: 3,
        bytes: new Uint8Array([7, 8]),
      },
    });
    expect(vi.mocked(invoke).mock.calls).toEqual([
      [
        'inspect_recovery_draft',
        {
          documentPath: '/docs/report.pdf',
          sourceBytes: [1, 2],
        },
      ],
      [
        'read_recovery_draft',
        {
          documentPath: '/docs/report.pdf',
          sourceVersion: 'source-v1',
          editedRevision: 3,
        },
      ],
    ]);
  });

  it('passes edited revision and bytes to the native atomic writer', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await nativeRecoveryDraftAdapter.write({
      documentPath: '/docs/report.pdf',
      sourceVersion: 'source-v1',
      editedRevision: 4,
      bytes: new Uint8Array([3, 4]),
    });

    expect(invoke).toHaveBeenCalledWith('write_recovery_draft', {
      draft: {
        documentPath: '/docs/report.pdf',
        sourceVersion: 'source-v1',
        editedRevision: 4,
        bytes: [3, 4],
      },
    });
  });

  it('repairs a draft against an already-written source in one native operation', async () => {
    vi.mocked(invoke).mockResolvedValue({ sourceVersion: 'source-v2' });

    await expect(
      nativeRecoveryDraftAdapter.repairAfterWrite?.({
        documentPath: '/docs/report.pdf',
        sourceBytes: new Uint8Array([1]),
        editedRevision: 5,
        draftBytes: new Uint8Array([2]),
      }),
    ).resolves.toEqual({ sourceVersion: 'source-v2' });

    expect(invoke).toHaveBeenCalledWith('repair_recovery_draft_after_write', {
      repair: {
        documentPath: '/docs/report.pdf',
        sourceBytes: [1],
        editedRevision: 5,
        draftBytes: [2],
      },
    });
  });
});
