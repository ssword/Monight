import { describe, expect, it, vi } from 'vitest';
import { createTauriExternalLinkAdapter } from '../app/tauri-external-link-adapter';
import type { ExternalLinkAdapter } from '../reader/reader-actions';

interface ExternalLinkAdapterHarness {
  readonly adapter: ExternalLinkAdapter;
  readonly openedUrls: readonly string[];
}

function expectExternalLinkAdapterContract(
  name: string,
  createHarness: () => ExternalLinkAdapterHarness,
): void {
  describe(name, () => {
    it('opens an allowed URL through its platform boundary', async () => {
      const harness = createHarness();

      await harness.adapter.open('https://example.com/report');

      expect(harness.openedUrls).toEqual(['https://example.com/report']);
    });
  });
}

describe('External-link adapter contract', () => {
  expectExternalLinkAdapterContract('in-memory adapter', () => {
    const openedUrls: string[] = [];
    return {
      adapter: {
        async open(url) {
          openedUrls.push(url);
        },
      },
      openedUrls,
    };
  });

  expectExternalLinkAdapterContract('Tauri production adapter', () => {
    const openedUrls: string[] = [];
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe('open_external_url');
      openedUrls.push(args?.url as string);
    });
    return {
      adapter: createTauriExternalLinkAdapter(invoke),
      openedUrls,
    };
  });
});
