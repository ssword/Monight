import { Store } from '@tauri-apps/plugin-store';
import type { ViewMode } from '../lib/document-features';
import {
  type AnnotationDisplayName,
  DEFAULT_ANNOTATION_DISPLAY_NAME,
  normalizeAnnotationDisplayName,
} from '../reader/native-pdf-editing';
import {
  type PersistedReadingSession,
  READING_SESSION_SCHEMA_VERSION,
  type RestorableReadingPosition,
  type ZoomIntent,
} from '../reader/reader-actions';
import type { RecentDocument } from '../reader/recent-documents';
import type { FilterSettings } from './filters';
import {
  currentKeybindPlatform,
  defaultKeybinds,
  effectiveKeybinds,
  KEYBIND_DEFAULTS_VERSION,
  type KeybindConfig,
  type KeybindPlatform,
  migrateKeybinds,
} from './keybind-defaults';

export { normalizeAnnotationDisplayName } from '../reader/native-pdf-editing';

export interface SavedTabSession {
  filePath: string;
  title: string;
  filterSettings: FilterSettings;
  currentPage: number;
  zoom: number;
  zoomIntent?: ZoomIntent;
  scrollPosition?: number;
  readingPosition?: RestorableReadingPosition;
  viewMode: ViewMode;
}

export interface ReadingSession {
  version: 1;
  activeFilePath: string | null;
  tabs: SavedTabSession[];
}

export type { KeybindConfig, KeybindPlatform } from './keybind-defaults';

/**
 * Main settings interface
 */
export interface MoonightSettings {
  general: {
    maximizeOnOpen: boolean;
    defaultDarkMode: string; // preset name
    rememberLastFilter: boolean;
    restorePreviousSession: boolean;
    defaultViewMode: ViewMode;
    annotationDisplayName: AnnotationDisplayName;
  };
  keybinds: Record<string, KeybindConfig>;
  lastFilter?: FilterSettings;
}

export const SETTINGS_SCHEMA_VERSION = 1;
/** Store key of the keybind defaults version the stored keybinds were upgraded to. */
const KEYBIND_DEFAULTS_VERSION_KEY = 'keybindDefaultsVersion';

export type SettingsOwner = 'main' | 'settings';
type SettingsWindowKey = 'general' | 'keybinds';
type MainWindowKey = 'lastFilter';
type OwnedKey<Owner extends SettingsOwner> = Owner extends 'settings'
  ? SettingsWindowKey
  : MainWindowKey;

interface LegacyMoonightSettings extends Partial<MoonightSettings> {
  version?: string;
  lastSession?: ReadingSession;
  recentFiles?: RecentDocument[];
  annotations?: unknown;
}

const DEFAULT_GENERAL: MoonightSettings['general'] = {
  maximizeOnOpen: true,
  defaultDarkMode: 'default',
  rememberLastFilter: true,
  restorePreviousSession: true,
  defaultViewMode: 'continuous',
  annotationDisplayName: DEFAULT_ANNOTATION_DISPLAY_NAME,
};

/** Default settings for a platform; shortcuts differ between macOS and the others. */
export function defaultSettings(platform: KeybindPlatform): MoonightSettings {
  return { general: { ...DEFAULT_GENERAL }, keybinds: defaultKeybinds(platform) };
}

/** Default settings for the platform this window runs on. */
export const DEFAULT_SETTINGS: MoonightSettings = defaultSettings(currentKeybindPlatform());

const EMPTY_READING_SESSION: PersistedReadingSession = {
  schemaVersion: READING_SESSION_SCHEMA_VERSION,
  activeDocumentPath: null,
  documents: [],
};

function migrateLegacyReadingSession(session: ReadingSession | undefined): PersistedReadingSession {
  if (!session) return structuredClone(EMPTY_READING_SESSION);

  const documents = session.tabs.map((tab) => ({
    filePath: tab.filePath,
    title: tab.title,
    readingPosition:
      tab.scrollPosition !== undefined
        ? { page: tab.currentPage, legacyOffset: tab.scrollPosition }
        : { page: tab.currentPage, location: 0 },
    visualState: {
      filterSettings: tab.filterSettings,
      zoomIntent: tab.zoomIntent ?? { kind: 'manual' as const, scale: tab.zoom },
      viewMode: tab.viewMode,
    },
  }));

  return {
    schemaVersion: READING_SESSION_SCHEMA_VERSION,
    activeDocumentPath: documents.some((document) => document.filePath === session.activeFilePath)
      ? session.activeFilePath
      : null,
    documents,
  };
}

export interface SettingsManagerOptions {
  /** Selects the platform-dependent default shortcuts; detected when omitted. */
  readonly platform?: KeybindPlatform;
}

/** Persistent storage split by concern and constrained by window ownership. */
export class SettingsManager<Owner extends SettingsOwner = 'main'> {
  private store: Store | null = null;
  private readonly platform: KeybindPlatform;
  private settings: MoonightSettings;

  constructor(
    private readonly owner: Owner = 'main' as Owner,
    { platform = currentKeybindPlatform() }: SettingsManagerOptions = {},
  ) {
    this.platform = platform;
    this.settings = defaultSettings(platform);
  }

  private async initStore(): Promise<Store> {
    if (!this.store) this.store = await Store.load('settings.json');
    return this.store;
  }

  private async ensureMigrated(store: Store): Promise<void> {
    await this.ensureStorageMigrated(store);
    await this.ensureKeybindDefaults(store);
  }

  /**
   * Upgrades stored keybinds to the current defaults (keybind-defaults.ts);
   * only the main window writes the upgrade, the Settings window applies it
   * on load until then.
   */
  private async ensureKeybindDefaults(store: Store): Promise<void> {
    if (this.owner !== 'main') return;
    const { keybinds, version } = await this.storedKeybinds(store);
    if (version >= KEYBIND_DEFAULTS_VERSION) return;
    await store.set(
      'keybinds',
      keybinds ? migrateKeybinds(keybinds, version, this.platform) : defaultKeybinds(this.platform),
    );
    await store.set(KEYBIND_DEFAULTS_VERSION_KEY, KEYBIND_DEFAULTS_VERSION);
    await store.save();
  }

  private async storedKeybinds(
    store: Store,
  ): Promise<{ keybinds: MoonightSettings['keybinds'] | undefined; version: number }> {
    const [keybinds, version] = await Promise.all([
      store.get<MoonightSettings['keybinds']>('keybinds'),
      store.get<number>(KEYBIND_DEFAULTS_VERSION_KEY),
    ]);
    // Keybinds stored before defaults were versioned hold the first defaults.
    return { keybinds, version: version ?? 1 };
  }

  private async ensureStorageMigrated(store: Store): Promise<void> {
    if ((await store.get<number>('storageSchemaVersion')) === SETTINGS_SCHEMA_VERSION) return;
    if (this.owner !== 'main') {
      throw new Error('The main window must complete settings storage migration');
    }

    const legacy = await store.get<LegacyMoonightSettings>('settings');
    const legacyGeneral =
      legacy?.version === '1.0.0'
        ? { ...legacy.general, maximizeOnOpen: true, defaultViewMode: 'continuous' as const }
        : legacy?.general;
    const storedKeybinds = await store.get<MoonightSettings['keybinds']>('keybinds');
    const values = {
      general: (await store.get<MoonightSettings['general']>('general')) ?? {
        ...DEFAULT_GENERAL,
        ...legacyGeneral,
      },
      // Legacy keybinds hold the first defaults; ensureKeybindDefaults upgrades them.
      keybinds: storedKeybinds ?? legacy?.keybinds ?? defaultKeybinds(this.platform),
      readingSession:
        (await store.get<PersistedReadingSession>('readingSession')) ??
        migrateLegacyReadingSession(legacy?.lastSession),
      recentFiles: (await store.get<RecentDocument[]>('recentFiles')) ?? legacy?.recentFiles ?? [],
      lastFilter:
        (await store.get<FilterSettings | null>('lastFilter')) ?? legacy?.lastFilter ?? null,
    };

    await store.set('general', values.general);
    await store.set('keybinds', values.keybinds);
    if (!storedKeybinds && !legacy?.keybinds) {
      await store.set(KEYBIND_DEFAULTS_VERSION_KEY, KEYBIND_DEFAULTS_VERSION);
    }
    await store.set('readingSession', values.readingSession);
    await store.set('recentFiles', values.recentFiles);
    await store.set('lastFilter', values.lastFilter);
    await store.set('storageSchemaVersion', SETTINGS_SCHEMA_VERSION);
    if (legacy?.annotations === undefined) await store.delete('settings');
    await store.save();
  }

  async load(): Promise<MoonightSettings> {
    try {
      const store = await this.initStore();
      await this.ensureMigrated(store);
      const [general, { keybinds, version }, lastFilter] = await Promise.all([
        store.get<MoonightSettings['general']>('general'),
        this.storedKeybinds(store),
        store.get<FilterSettings | null>('lastFilter'),
      ]);
      const mergedGeneral = { ...DEFAULT_GENERAL, ...general };
      this.settings = {
        general: {
          ...mergedGeneral,
          annotationDisplayName: normalizeAnnotationDisplayName(
            mergedGeneral.annotationDisplayName,
          ),
        },
        keybinds: effectiveKeybinds(keybinds, version, this.platform),
        ...(lastFilter ? { lastFilter } : {}),
      };
      return structuredClone(this.settings);
    } catch (error) {
      console.error('Error loading settings:', error);
      return defaultSettings(this.platform);
    }
  }

  get<K extends keyof MoonightSettings>(key: K): MoonightSettings[K] {
    return structuredClone(this.settings[key]);
  }

  async set<K extends OwnedKey<Owner>>(key: K, value: MoonightSettings[K]): Promise<void> {
    this.assertOwnership(key);
    const store = await this.initStore();
    await store.set(key, value);
    await store.save();
    this.settings = { ...this.settings, [key]: structuredClone(value) };
  }

  getAll(): MoonightSettings {
    return structuredClone(this.settings);
  }

  async readPersistedReadingSession(): Promise<unknown> {
    const store = await this.initStore();
    await this.ensureMigrated(store);
    return await store.get('readingSession');
  }

  async writePersistedReadingSession(session: PersistedReadingSession): Promise<void> {
    this.assertMainOwnership('readingSession');
    const store = await this.initStore();
    await store.set('readingSession', session);
    await store.save();
  }

  async clearPersistedReadingSession(): Promise<void> {
    this.assertMainOwnership('readingSession');
    const store = await this.initStore();
    await store.set('readingSession', EMPTY_READING_SESSION);
    await store.save();
  }

  async readLegacyReadingSession(): Promise<undefined> {
    return undefined;
  }

  async removeLegacyReadingSession(): Promise<void> {}

  async readLegacyRecentDocuments(): Promise<unknown> {
    const store = await this.initStore();
    await this.ensureMigrated(store);
    return await store.get('recentFiles');
  }

  async removeLegacyRecentDocuments(): Promise<void> {
    this.assertMainOwnership('Recent Documents');
    const store = await this.initStore();
    await store.delete('recentFiles');
    await store.save();
  }

  async reset(): Promise<void> {
    if (this.owner !== 'settings') throw new Error('Only the Settings window can reset settings');
    const defaults = defaultSettings(this.platform);
    await this.writeConcern('general', defaults.general);
    await this.writeConcern('keybinds', defaults.keybinds);
    this.settings = defaults;
  }

  private async writeConcern(key: string, value: unknown): Promise<void> {
    const store = await this.initStore();
    await store.set(key, value);
    await store.save();
  }

  private assertOwnership(key: string): void {
    const allowed =
      this.owner === 'settings'
        ? new Set<string>(['general', 'keybinds'])
        : new Set<string>(['lastFilter']);
    if (!allowed.has(key)) {
      const label = this.owner === 'settings' ? 'Settings' : 'Main';
      throw new Error(`${label} window cannot write ${key}`);
    }
  }

  private assertMainOwnership(key: string): void {
    if (this.owner !== 'main') throw new Error(`Settings window cannot write ${key}`);
  }
}
