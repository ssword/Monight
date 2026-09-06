import { invoke } from '@tauri-apps/api/core';
import type { ExternalLinkAdapter } from '../reader/reader-actions';

export type ExternalLinkInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export function createTauriExternalLinkAdapter(
  invokeCommand: ExternalLinkInvoke = (command, args) => invoke(command, args),
): ExternalLinkAdapter {
  return {
    async open(url) {
      await invokeCommand('open_external_url', { url });
    },
  };
}
