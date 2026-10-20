import { invoke, isTauri } from '@tauri-apps/api/core';
import type { PrintAdapter } from '../reader/reader-actions';
import { browserPrintAdapter } from './browser-print-adapter';

export function createTauriPrintAdapter({
  nativeMacOS = () => isTauri() && navigator.platform.startsWith('Mac'),
  invokeCommand = (command: string, args: Record<string, unknown>) => invoke(command, args),
  fallback = browserPrintAdapter,
}: {
  nativeMacOS?: () => boolean;
  invokeCommand?: (command: string, args: Record<string, unknown>) => Promise<unknown>;
  fallback?: PrintAdapter;
} = {}): PrintAdapter {
  return {
    async print(request) {
      if (nativeMacOS()) {
        await invokeCommand('print_pdf', {
          bytes: Array.from(request.bytes),
          title: request.title,
        });
      } else {
        await fallback.print(request);
      }
    },
  };
}
