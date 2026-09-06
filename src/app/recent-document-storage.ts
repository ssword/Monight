import { Store } from '@tauri-apps/plugin-store';
import type { PersistedRecentDocuments, RecentDocumentStorage } from '../reader/recent-documents';

interface LegacyRecentDocumentStorage {
  readLegacyRecentDocuments(): Promise<unknown>;
  removeLegacyRecentDocuments(): Promise<void>;
}

export function createRecentDocumentStorage(
  legacy: LegacyRecentDocumentStorage,
): RecentDocumentStorage {
  let store: Store | null = null;

  const getStore = async (): Promise<Store> => {
    if (!store) store = await Store.load('recent-documents.json');
    return store;
  };

  return {
    async read() {
      return await (await getStore()).get('recentDocuments');
    },
    async write(recentDocuments: PersistedRecentDocuments) {
      const recentDocumentStore = await getStore();
      await recentDocumentStore.set('recentDocuments', recentDocuments);
      await recentDocumentStore.save();
    },
    readLegacy: () => legacy.readLegacyRecentDocuments(),
    removeLegacy: () => legacy.removeLegacyRecentDocuments(),
  };
}
