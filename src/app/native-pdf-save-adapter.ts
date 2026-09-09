import { invoke } from '@tauri-apps/api/core';
import type { NativePdfSaveAdapter, PdfSaveDestination } from '../reader/native-pdf-editing';

export const inspectNativePdfEditing = (bytes: Uint8Array): Promise<string | null> =>
  invoke('inspect_pdf_editing', { bytes: Array.from(bytes) });

export const nativePdfSaveAdapter: NativePdfSaveAdapter = {
  chooseDestination: (title) =>
    invoke<PdfSaveDestination | null>('choose_pdf_save_destination', { title }),
  async writeNew(destination, bytes, original) {
    const response = await invoke<ArrayBuffer>('write_new_pdf', {
      token: destination.token,
      bytes: Array.from(bytes),
      original: Array.from(original),
    });
    if (!(response instanceof ArrayBuffer)) throw new Error('Invalid native PDF write response');
    return new Uint8Array(response);
  },
  releaseDestination: ({ token }) => invoke('release_pdf_save_destination', { token }),
};
