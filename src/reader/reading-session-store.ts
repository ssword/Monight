import type {
  PersistedReadingSession,
  ReadingSessionDocument,
  ReadingSessionVisualState,
  ZoomIntent,
} from './reader-actions';

export interface ReadingSessionStorage {
  read(): Promise<unknown>;
  write(session: PersistedReadingSession): Promise<void>;
  readLegacy(): Promise<unknown>;
  removeLegacy(): Promise<void>;
}

interface LegacyDocument {
  filePath: string;
  title: string;
  currentPage: number;
  scrollPosition?: number;
  filterSettings?: ReadingSessionVisualState['filterSettings'];
  zoom?: number;
  rotation?: number;
  viewMode?: 'single' | 'continuous' | 'spread';
}

interface LegacyReadingSession {
  activeFilePath: string | null;
  tabs: LegacyDocument[];
}

export const EMPTY_READING_SESSION: PersistedReadingSession = {
  schemaVersion: 2,
  activeDocumentPath: null,
  documents: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseZoomIntent(value: unknown, legacyZoom: unknown): ZoomIntent | null {
  if (isRecord(value)) {
    if (value.kind === 'fit-width' || value.kind === 'fit-page') return { kind: value.kind };
    if (
      value.kind === 'manual' &&
      typeof value.scale === 'number' &&
      Number.isFinite(value.scale) &&
      value.scale > 0
    ) {
      return { kind: 'manual', scale: value.scale };
    }
  }
  if (typeof legacyZoom === 'number' && Number.isFinite(legacyZoom) && legacyZoom > 0) {
    return { kind: 'manual', scale: legacyZoom };
  }
  return null;
}

function parseVisualState(value: unknown): ReadingSessionVisualState | undefined {
  if (!isRecord(value) || !isRecord(value.filterSettings)) return undefined;
  const filterSettings = value.filterSettings;
  const filterKeys = [
    'brightness',
    'grayscale',
    'invert',
    'sepia',
    'hue',
    'extraBrightness',
  ] as const;
  if (filterKeys.some((key) => typeof filterSettings[key] !== 'number')) return undefined;
  if (
    typeof value.rotation !== 'number' ||
    (value.viewMode !== 'single' && value.viewMode !== 'continuous' && value.viewMode !== 'spread')
  ) {
    return undefined;
  }
  const zoomIntent = parseZoomIntent(value.zoomIntent, value.zoom);
  if (!zoomIntent) return undefined;
  return {
    filterSettings: {
      brightness: filterSettings.brightness as number,
      grayscale: filterSettings.grayscale as number,
      invert: filterSettings.invert as number,
      sepia: filterSettings.sepia as number,
      hue: filterSettings.hue as number,
      extraBrightness: filterSettings.extraBrightness as number,
    },
    zoomIntent,
    rotation: value.rotation,
    viewMode: value.viewMode,
  };
}

function parseDocument(value: unknown): ReadingSessionDocument | null {
  if (!isRecord(value) || typeof value.filePath !== 'string' || value.filePath.length === 0) {
    return null;
  }
  if (typeof value.title !== 'string' || !isRecord(value.readingPosition)) return null;
  const { page, location, legacyOffset, scrollPosition } = value.readingPosition;
  if (!Number.isInteger(page) || (page as number) < 1) return null;

  const hasLocation =
    typeof location === 'number' && Number.isFinite(location) && location >= 0 && location <= 1;
  const oldScrollPosition = legacyOffset ?? scrollPosition;
  const hasLegacyOffset =
    typeof oldScrollPosition === 'number' &&
    Number.isFinite(oldScrollPosition) &&
    oldScrollPosition >= 0;
  if (!hasLocation && !hasLegacyOffset) return null;

  const visualState = parseVisualState(value.visualState);
  if (value.visualState !== undefined && !visualState) return null;
  return {
    filePath: value.filePath,
    title: value.title,
    readingPosition: hasLocation
      ? { page: page as number, location: location as number }
      : { page: page as number, legacyOffset: oldScrollPosition as number },
    ...(visualState ? { visualState } : {}),
  };
}

export function parseReadingSession(value: unknown): PersistedReadingSession | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    !Array.isArray(value.documents)
  ) {
    return null;
  }
  if (value.activeDocumentPath !== null && typeof value.activeDocumentPath !== 'string') {
    return null;
  }
  const documents = value.documents.map(parseDocument);
  if (documents.some((document) => document === null)) return null;
  const validDocuments = documents as ReadingSessionDocument[];
  const paths = validDocuments.map((document) => document.filePath);
  if (new Set(paths).size !== paths.length) return null;
  if (value.activeDocumentPath !== null && !paths.includes(value.activeDocumentPath)) return null;
  return {
    schemaVersion: 2,
    activeDocumentPath: value.activeDocumentPath,
    documents: validDocuments,
  };
}

function parseLegacyReadingSession(value: unknown): LegacyReadingSession | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;
  if (value.activeFilePath !== null && typeof value.activeFilePath !== 'string') return null;
  const tabs: LegacyDocument[] = [];
  for (const tab of value.tabs) {
    if (
      !isRecord(tab) ||
      typeof tab.filePath !== 'string' ||
      typeof tab.title !== 'string' ||
      !Number.isInteger(tab.currentPage) ||
      (tab.currentPage as number) < 1
    ) {
      return null;
    }
    tabs.push({
      filePath: tab.filePath,
      title: tab.title,
      currentPage: tab.currentPage as number,
      ...(typeof tab.scrollPosition === 'number' &&
      Number.isFinite(tab.scrollPosition) &&
      tab.scrollPosition >= 0
        ? { scrollPosition: tab.scrollPosition }
        : {}),
      ...(isRecord(tab.filterSettings)
        ? {
            filterSettings: parseVisualState({
              filterSettings: tab.filterSettings,
              zoom: tab.zoom,
              rotation: tab.rotation ?? 0,
              viewMode: tab.viewMode,
            })?.filterSettings,
          }
        : {}),
      ...(typeof tab.zoom === 'number' ? { zoom: tab.zoom } : {}),
      ...(typeof tab.rotation === 'number' ? { rotation: tab.rotation } : {}),
      ...(tab.viewMode === 'single' || tab.viewMode === 'continuous' || tab.viewMode === 'spread'
        ? { viewMode: tab.viewMode }
        : {}),
    });
  }
  return { activeFilePath: value.activeFilePath, tabs };
}

function migrateLegacyReadingSession(legacy: LegacyReadingSession): PersistedReadingSession {
  const documents = legacy.tabs.map((tab) => ({
    filePath: tab.filePath,
    title: tab.title,
    readingPosition:
      tab.scrollPosition !== undefined
        ? { page: tab.currentPage, legacyOffset: tab.scrollPosition }
        : { page: tab.currentPage, location: 0 },
    ...(tab.filterSettings && tab.zoom !== undefined && tab.viewMode
      ? {
          visualState: {
            filterSettings: tab.filterSettings,
            zoomIntent: { kind: 'manual' as const, scale: tab.zoom },
            rotation: tab.rotation ?? 0,
            viewMode: tab.viewMode,
          },
        }
      : {}),
  }));
  const activeDocumentPath = documents.some(
    (document) => document.filePath === legacy.activeFilePath,
  )
    ? legacy.activeFilePath
    : null;
  return { schemaVersion: 2, activeDocumentPath, documents };
}

export async function loadReadingSession(
  storage: ReadingSessionStorage,
): Promise<PersistedReadingSession> {
  const rawStored = await storage.read();
  const stored = parseReadingSession(rawStored);
  if (stored) {
    if (!isRecord(rawStored) || rawStored.schemaVersion !== 2) {
      await storage.write(stored);
      const verifiedRaw = await storage.read();
      const verified = parseReadingSession(verifiedRaw);
      if (!verified || !isRecord(verifiedRaw) || verifiedRaw.schemaVersion !== 2) {
        throw new Error('Reading Session schema migration could not be verified');
      }
    }
    if ((await storage.readLegacy()) !== undefined) {
      try {
        await storage.removeLegacy();
      } catch {
        // The verified new value remains authoritative; retry cleanup on the next load.
      }
    }
    return stored;
  }

  const legacy = parseLegacyReadingSession(await storage.readLegacy());
  if (!legacy) return EMPTY_READING_SESSION;

  const migrated = migrateLegacyReadingSession(legacy);
  const validated = parseReadingSession(migrated);
  if (!validated) {
    throw new Error('Legacy Reading Session converted to invalid data');
  }
  await storage.write(validated);
  const verifiedRaw = await storage.read();
  const verified = parseReadingSession(verifiedRaw);
  if (!verified || !isRecord(verifiedRaw) || verifiedRaw.schemaVersion !== 2) {
    throw new Error('Reading Session migration could not be verified');
  }
  await storage.removeLegacy();
  return verified;
}
