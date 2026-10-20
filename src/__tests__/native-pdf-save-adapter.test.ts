import { runInNewContext } from 'node:vm';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativePdfSaveAdapter } from '../app/native-pdf-save-adapter';
import type { NativePdfSaveAdapter } from '../reader/native-pdf-editing';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const adapter = nativePdfSaveAdapter as Required<NativePdfSaveAdapter>;

describe('native PDF save adapter', () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it.each([
    ['an ArrayBuffer', () => new Uint8Array([4, 5]).buffer],
    ['an ArrayBuffer from Tauri isolation', () => runInNewContext('new Uint8Array([4, 5]).buffer')],
    ['a typed byte view', () => new Uint8Array([9, 4, 5]).subarray(1)],
    ['the numeric byte array fallback', () => [4, 5]],
  ])('accepts reopened bytes returned as %s', async (_, response) => {
    vi.mocked(invoke).mockResolvedValue(response());

    await expect(adapter.writeOriginal('token', new Uint8Array([1]))).resolves.toEqual(
      new Uint8Array([4, 5]),
    );
    await expect(
      adapter.writeDestination(
        { token: 'destination', canonicalPath: '/docs/copy.pdf', title: 'copy.pdf' },
        new Uint8Array([1]),
        'source',
      ),
    ).resolves.toEqual(new Uint8Array([4, 5]));
    await expect(adapter.readSource('/docs/report.pdf')).resolves.toEqual(new Uint8Array([4, 5]));
    await expect(adapter.prepareBytes(new Uint8Array([1]))).resolves.toEqual(
      new Uint8Array([4, 5]),
    );
  });

  it('rejects a response that is not PDF bytes', async () => {
    vi.mocked(invoke).mockResolvedValue({ bytes: [4, 5] });

    await expect(adapter.writeOriginal('token', new Uint8Array([1]))).rejects.toThrow(
      'Invalid native PDF write response',
    );
  });
});
