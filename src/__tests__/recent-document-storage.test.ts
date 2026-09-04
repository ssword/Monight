import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => {
  const values = new Map<string, Map<string, unknown>>();
  const load = vi.fn(async (fileName: string) => {
    let store = values.get(fileName);
    if (!store) {
      store = new Map();
      values.set(fileName, store);
    }
    return {
      get: vi.fn(async (key: string) => structuredClone(store?.get(key))),
      set: vi.fn(async (key: string, value: unknown) => {
        store?.set(key, structuredClone(value));
      }),
      save: vi.fn(async () => undefined),
    };
  });
  return { load, values };
});

vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load: stores.load } }));

import { createRecentDocumentStorage } from '../app/recent-document-storage';

describe('Recent Document storage adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.values.clear();
  });

  it('uses a dedicated store and delegates legacy cleanup to settings migration access', async () => {
    const legacy = [{ filePath: '/docs/report.pdf', title: 'report.pdf', openedAt: 10 }];
    const settings = {
      readLegacyRecentDocuments: vi.fn(async () => legacy),
      removeLegacyRecentDocuments: vi.fn(async () => undefined),
    };
    const storage = createRecentDocumentStorage(settings);
    const persisted = { schemaVersion: 1 as const, documents: legacy };

    await storage.write(persisted);

    expect(stores.load).toHaveBeenCalledWith('recent-documents.json');
    expect(stores.values.get('recent-documents.json')?.get('recentDocuments')).toEqual(persisted);
    await expect(storage.readLegacy()).resolves.toEqual(legacy);
    await storage.removeLegacy();
    expect(settings.removeLegacyRecentDocuments).toHaveBeenCalledOnce();
  });
});
