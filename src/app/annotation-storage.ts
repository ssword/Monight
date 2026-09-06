import { Store } from '@tauri-apps/plugin-store';
import type { AnnotationStorage, PersistedAnnotations } from '../reader/annotations';

interface LegacyAnnotationStorage {
  readLegacyAnnotations(): Promise<unknown>;
  removeLegacyAnnotations(): Promise<void>;
}

export function createAnnotationStorage(legacy: LegacyAnnotationStorage): AnnotationStorage {
  let store: Store | null = null;

  const getStore = async (): Promise<Store> => {
    if (!store) store = await Store.load('annotations.json');
    return store;
  };

  return {
    async read() {
      return await (await getStore()).get('annotations');
    },
    async write(annotations: PersistedAnnotations) {
      const annotationStore = await getStore();
      await annotationStore.set('annotations', annotations);
      await annotationStore.save();
    },
    readLegacy: () => legacy.readLegacyAnnotations(),
    removeLegacy: () => legacy.removeLegacyAnnotations(),
  };
}
