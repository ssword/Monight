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

import { createAnnotationStorage } from '../app/annotation-storage';

describe('Annotation storage adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.values.clear();
  });

  it('uses a dedicated store and delegates legacy cleanup to settings migration access', async () => {
    const legacy = { '/docs/report.pdf': [] };
    const settings = {
      readLegacyAnnotations: vi.fn(async () => legacy),
      removeLegacyAnnotations: vi.fn(async () => undefined),
    };
    const storage = createAnnotationStorage(settings);
    const persisted = { schemaVersion: 1 as const, documents: {} };

    await storage.write(persisted);

    expect(stores.load).toHaveBeenCalledWith('annotations.json');
    expect(stores.values.get('annotations.json')?.get('annotations')).toEqual(persisted);
    await expect(storage.readLegacy()).resolves.toEqual(legacy);
    await storage.removeLegacy();
    expect(settings.removeLegacyAnnotations).toHaveBeenCalledOnce();
  });
});
