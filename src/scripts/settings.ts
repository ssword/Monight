import { Store } from '@tauri-apps/plugin-store';
import type { PdfAnnotation, ViewMode } from '../lib/document-features';
import type {
  PersistedReadingSession,
  RestorableReadingPosition,
  ZoomIntent,
} from '../reader/reader-actions';
import type { RecentDocument } from '../reader/recent-documents';
import type { FilterSettings } from './filters';

export interface SavedTabSession {
  filePath: string;
  title: string;
  filterSettings: FilterSettings;
  currentPage: number;
  zoom: number;
  zoomIntent?: ZoomIntent;
  rotation?: number;
  scrollPosition?: number;
  readingPosition?: RestorableReadingPosition;
  viewMode: ViewMode;
}

export interface ReadingSession {
  version: 1;
  activeFilePath: string | null;
  tabs: SavedTabSession[];
}

/**
 * Keybind configuration interface
 */
export interface KeybindConfig {
  displayName: string;
  binds: string[];
  action: string;
  data?: string;
}

/**
 * Main settings interface
 */
export interface MoonightSettings {
  general: {
    maximizeOnOpen: boolean;
    displayThumbs: boolean;
    defaultDarkMode: string; // preset name
    rememberLastFilter: boolean;
    restorePreviousSession: boolean;
    defaultViewMode: ViewMode;
  };
  keybinds: Record<string, KeybindConfig>;
  lastFilter?: FilterSettings;
}

export const SETTINGS_SCHEMA_VERSION = 1;

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
  annotations?: Record<string, PdfAnnotation[]>;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: MoonightSettings = {
  general: {
    maximizeOnOpen: true,
    displayThumbs: true,
    defaultDarkMode: 'default',
    rememberLastFilter: true,
    restorePreviousSession: true,
    defaultViewMode: 'continuous',
  },
  keybinds: {
    OpenFile: {
      displayName: 'Open PDF',
      binds: ['CmdOrCtrl+O'],
      action: 'openFile',
    },
    CloseTab: {
      displayName: 'Close Tab',
      binds: ['CmdOrCtrl+W'],
      action: 'closeTab',
    },
    ReopenTab: {
      displayName: 'Reopen Tab',
      binds: ['CmdOrCtrl+Shift+T'],
      action: 'reopenTab',
    },
    NextTab: {
      displayName: 'Next Tab',
      binds: ['CmdOrCtrl+Tab', 'CmdOrCtrl+PageDown'],
      action: 'nextTab',
    },
    PreviousTab: {
      displayName: 'Previous Tab',
      binds: ['CmdOrCtrl+Shift+Tab', 'CmdOrCtrl+PageUp'],
      action: 'previousTab',
    },
    Print: {
      displayName: 'Print',
      binds: ['CmdOrCtrl+P'],
      action: 'print',
    },
    Find: {
      displayName: 'Find in Document',
      binds: ['CmdOrCtrl+F'],
      action: 'find',
    },
    ZoomIn: {
      displayName: 'Zoom In',
      binds: ['CmdOrCtrl+=', 'CmdOrCtrl+Plus'],
      action: 'zoomIn',
    },
    ZoomOut: {
      displayName: 'Zoom Out',
      binds: ['CmdOrCtrl+-'],
      action: 'zoomOut',
    },
    ResetZoom: {
      displayName: 'Reset Zoom',
      binds: ['CmdOrCtrl+0'],
      action: 'resetZoom',
    },
    Settings: {
      displayName: 'Open Settings',
      binds: ['Alt+S'], // Default to Alt+S, will be overridden with Cmd+, on Mac during init
      action: 'openSettings',
    },
    NextPage: {
      displayName: 'Next Page',
      binds: ['ArrowRight', 'ArrowDown'],
      action: 'nextPage',
    },
    PreviousPage: {
      displayName: 'Previous Page',
      binds: ['ArrowLeft', 'ArrowUp'],
      action: 'previousPage',
    },
    FirstPage: {
      displayName: 'First Page',
      binds: ['Home'],
      action: 'firstPage',
    },
    LastPage: {
      displayName: 'Last Page',
      binds: ['End'],
      action: 'lastPage',
    },
    FitToWidth: {
      displayName: 'Fit to Width',
      binds: ['CmdOrCtrl+Shift+W'],
      action: 'fitToWidth',
    },
    FitToPage: {
      displayName: 'Fit to Page',
      binds: ['CmdOrCtrl+Shift+P'],
      action: 'fitToPage',
    },
    RotateClockwise: {
      displayName: 'Rotate Right',
      binds: ['CmdOrCtrl+R'],
      action: 'rotateRight',
    },
    RotateCounterClockwise: {
      displayName: 'Rotate Left',
      binds: ['CmdOrCtrl+Shift+R'],
      action: 'rotateLeft',
    },
    SwitchToTab1: {
      displayName: 'Switch to Tab 1',
      binds: ['CmdOrCtrl+1'],
      action: 'switchToTab',
      data: '1',
    },
    SwitchToTab2: {
      displayName: 'Switch to Tab 2',
      binds: ['CmdOrCtrl+2'],
      action: 'switchToTab',
      data: '2',
    },
    SwitchToTab3: {
      displayName: 'Switch to Tab 3',
      binds: ['CmdOrCtrl+3'],
      action: 'switchToTab',
      data: '3',
    },
    SwitchToTab4: {
      displayName: 'Switch to Tab 4',
      binds: ['CmdOrCtrl+4'],
      action: 'switchToTab',
      data: '4',
    },
    SwitchToTab5: {
      displayName: 'Switch to Tab 5',
      binds: ['CmdOrCtrl+5'],
      action: 'switchToTab',
      data: '5',
    },
    SwitchToTab6: {
      displayName: 'Switch to Tab 6',
      binds: ['CmdOrCtrl+6'],
      action: 'switchToTab',
      data: '6',
    },
    SwitchToTab7: {
      displayName: 'Switch to Tab 7',
      binds: ['CmdOrCtrl+7'],
      action: 'switchToTab',
      data: '7',
    },
    SwitchToTab8: {
      displayName: 'Switch to Tab 8',
      binds: ['CmdOrCtrl+8'],
      action: 'switchToTab',
      data: '8',
    },
    SwitchToTab9: {
      displayName: 'Switch to Last Tab',
      binds: ['CmdOrCtrl+9'],
      action: 'switchToTab',
      data: '9',
    },
    Fullscreen: {
      displayName: 'Toggle Fullscreen',
      binds: ['F11'],
      action: 'toggleFullscreen',
    },
    PresentationMode: {
      displayName: 'Presentation Mode',
      binds: ['Shift+F11'],
      action: 'presentationMode',
    },
  },
};

const EMPTY_READING_SESSION: PersistedReadingSession = {
  schemaVersion: 2,
  activeDocumentPath: null,
  documents: [],
};

function cloneDefaults(): MoonightSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

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
      rotation: tab.rotation ?? 0,
      viewMode: tab.viewMode,
    },
  }));

  return {
    schemaVersion: 2,
    activeDocumentPath: documents.some((document) => document.filePath === session.activeFilePath)
      ? session.activeFilePath
      : null,
    documents,
  };
}

/** Persistent storage split by concern and constrained by window ownership. */
export class SettingsManager<Owner extends SettingsOwner = 'main'> {
  private store: Store | null = null;
  private settings: MoonightSettings = cloneDefaults();

  constructor(private readonly owner: Owner = 'main' as Owner) {}

  private async initStore(): Promise<Store> {
    if (!this.store) this.store = await Store.load('settings.json');
    return this.store;
  }

  private async ensureMigrated(store: Store): Promise<void> {
    if ((await store.get<number>('storageSchemaVersion')) === SETTINGS_SCHEMA_VERSION) return;
    if (this.owner !== 'main') {
      throw new Error('The main window must complete settings storage migration');
    }

    const legacy = await store.get<LegacyMoonightSettings>('settings');
    const legacyGeneral =
      legacy?.version === '1.0.0'
        ? { ...legacy.general, maximizeOnOpen: true, defaultViewMode: 'continuous' as const }
        : legacy?.general;
    const values = {
      general: (await store.get<MoonightSettings['general']>('general')) ?? {
        ...DEFAULT_SETTINGS.general,
        ...legacyGeneral,
      },
      keybinds: (await store.get<MoonightSettings['keybinds']>('keybinds')) ?? {
        ...DEFAULT_SETTINGS.keybinds,
        ...legacy?.keybinds,
      },
      readingSession:
        (await store.get<PersistedReadingSession>('readingSession')) ??
        migrateLegacyReadingSession(legacy?.lastSession),
      recentFiles: (await store.get<RecentDocument[]>('recentFiles')) ?? legacy?.recentFiles ?? [],
      annotations:
        (await store.get<Record<string, PdfAnnotation[]>>('annotations')) ??
        legacy?.annotations ??
        {},
      lastFilter:
        (await store.get<FilterSettings | null>('lastFilter')) ?? legacy?.lastFilter ?? null,
    };

    await store.set('general', values.general);
    await store.set('keybinds', values.keybinds);
    await store.set('readingSession', values.readingSession);
    await store.set('recentFiles', values.recentFiles);
    await store.set('annotations', values.annotations);
    await store.set('lastFilter', values.lastFilter);
    await store.set('storageSchemaVersion', SETTINGS_SCHEMA_VERSION);
    await store.delete('settings');
    await store.save();
  }

  async load(): Promise<MoonightSettings> {
    try {
      const store = await this.initStore();
      await this.ensureMigrated(store);
      const [general, keybinds, lastFilter] = await Promise.all([
        store.get<MoonightSettings['general']>('general'),
        store.get<MoonightSettings['keybinds']>('keybinds'),
        store.get<FilterSettings | null>('lastFilter'),
      ]);
      this.settings = {
        general: { ...DEFAULT_SETTINGS.general, ...general },
        keybinds: { ...DEFAULT_SETTINGS.keybinds, ...keybinds },
        ...(lastFilter ? { lastFilter } : {}),
      };
      return structuredClone(this.settings);
    } catch (error) {
      console.error('Error loading settings:', error);
      return cloneDefaults();
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

  async readLegacyAnnotations(): Promise<unknown> {
    const store = await this.initStore();
    await this.ensureMigrated(store);
    return await store.get('annotations');
  }

  async removeLegacyAnnotations(): Promise<void> {
    this.assertMainOwnership('annotations');
    const store = await this.initStore();
    await store.delete('annotations');
    await store.save();
  }

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
    const defaults = cloneDefaults();
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
