import { invoke } from '@tauri-apps/api/core';
import type { NativePdfSaveAdapter, PdfSaveDestination } from '../reader/native-pdf-editing';
import { bytesFromNativeResponse } from './native-bytes';

export const inspectNativePdfEditing = (bytes: Uint8Array): Promise<string | null> =>
  invoke('inspect_pdf_editing', { bytes: Array.from(bytes) });

export const nativePdfSaveAdapter: NativePdfSaveAdapter = {
  async prepareBytes(bytes) {
    return bytesFromNativeResponse(
      await invoke('prepare_pdf_save', { bytes: Array.from(bytes) }),
      'Invalid prepared native PDF response',
    );
  },
  captureSource: (filePath, bytes) =>
    invoke('capture_pdf_source', { path: filePath, bytes: Array.from(bytes) }),
  releaseSource: (token) => invoke('release_pdf_source', { token }),
  async readSource(filePath) {
    return bytesFromNativeResponse(
      await invoke('read_pdf_file', { path: filePath }),
      'Invalid native PDF read response',
    );
  },
  async writeOriginal(token, bytes) {
    return bytesFromNativeResponse(
      await invoke('write_original_pdf', { token, bytes: Array.from(bytes) }),
      'Invalid native PDF write response',
    );
  },
  chooseDestination: (title) =>
    invoke<PdfSaveDestination | null>('choose_pdf_save_destination', { title }),
  async writeDestination(destination, bytes, sourceToken) {
    return bytesFromNativeResponse(
      await invoke('write_pdf_destination', {
        token: destination.token,
        bytes: Array.from(bytes),
        sourceToken,
      }),
      'Invalid native PDF write response',
    );
  },
  releaseDestination: ({ token }) => invoke('release_pdf_save_destination', { token }),
};
