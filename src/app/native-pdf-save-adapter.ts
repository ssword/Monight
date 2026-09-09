import { invoke } from '@tauri-apps/api/core';
import type { NativePdfSaveAdapter, PdfSaveDestination } from '../reader/native-pdf-editing';

export const inspectNativePdfEditing = (bytes: Uint8Array): Promise<string | null> =>
  invoke('inspect_pdf_editing', { bytes: Array.from(bytes) });

export const nativePdfSaveAdapter: NativePdfSaveAdapter = {
  captureSource: (filePath, bytes) =>
    invoke('capture_pdf_source', { path: filePath, bytes: Array.from(bytes) }),
  releaseSource: (token) => invoke('release_pdf_source', { token }),
  async readSource(filePath) {
    const response = await invoke<ArrayBuffer>('read_pdf_file', { path: filePath });
    if (!(response instanceof ArrayBuffer)) throw new Error('Invalid native PDF read response');
    return new Uint8Array(response);
  },
  async writeOriginal(token, bytes) {
    const response = await invoke<ArrayBuffer>('write_original_pdf', {
      token,
      bytes: Array.from(bytes),
    });
    if (!(response instanceof ArrayBuffer)) throw new Error('Invalid native PDF write response');
    return new Uint8Array(response);
  },
  chooseDestination: (title) =>
    invoke<PdfSaveDestination | null>('choose_pdf_save_destination', { title }),
  async writeDestination(destination, bytes, sourceToken) {
    const response = await invoke<ArrayBuffer>('write_pdf_destination', {
      token: destination.token,
      bytes: Array.from(bytes),
      sourceToken,
    });
    if (!(response instanceof ArrayBuffer)) throw new Error('Invalid native PDF write response');
    return new Uint8Array(response);
  },
  releaseDestination: ({ token }) => invoke('release_pdf_save_destination', { token }),
};
