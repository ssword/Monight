import { Store } from '@tauri-apps/plugin-store';
import type { FilterSettings } from './filters';

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
  version: string;
  general: {
    maximizeOnOpen: boolean;
    displayThumbs: boolean;
    defaultDarkMode: string; // preset name
    rememberLastFilter: boolean;
  };
  keybinds: Record<string, KeybindConfig>;
  lastFilter?: FilterSettings;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: MoonightSettings = {
  version: '1.0.0',
  general: {
    maximizeOnOpen: false,
    displayThumbs: true,
    defaultDarkMode: 'default',
    rememberLastFilter: true,
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
  },
};

/**
 * Settings Manager class for persistent storage
 */
export class SettingsManager {
  private store: Store | null = null;
  private settings: MoonightSettings;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
  }

  /**
   * Initialize the store
   */
  private async initStore(): Promise<Store> {
    if (!this.store) {
      this.store = await Store.load('settings.json');
    }
    return this.store;
  }

  /**
   * Load settings from persistent storage
   */
  async load(): Promise<MoonightSettings> {
    try {
      const store = await this.initStore();
      const stored = await store.get<MoonightSettings>('settings');
      if (stored && stored.version) {
        // Merge with defaults to handle new settings added in updates
        this.settings = this.mergeSettings(DEFAULT_SETTINGS, stored);
      }
      return this.settings;
    } catch (error) {
      console.error('Error loading settings:', error);
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Save settings to persistent storage
   */
  async save(): Promise<void> {
    try {
      const store = await this.initStore();
      await store.set('settings', this.settings);
      await store.save();
    } catch (error) {
      console.error('Error saving settings:', error);
      throw error;
    }
  }

  /**
   * Get a specific setting value
   */
  get<K extends keyof MoonightSettings>(key: K): MoonightSettings[K] {
    return this.settings[key];
  }

  /**
   * Set a specific setting value and save
   */
  async set<K extends keyof MoonightSettings>(
    key: K,
    value: MoonightSettings[K],
  ): Promise<void> {
    this.settings[key] = value;
    await this.save();
  }

  /**
   * Get all settings
   */
  getAll(): MoonightSettings {
    return { ...this.settings };
  }

  /**
   * Update multiple settings at once
   */
  async updateMultiple(updates: Partial<MoonightSettings>): Promise<void> {
    this.settings = { ...this.settings, ...updates };
    await this.save();
  }

  /**
   * Reset settings to defaults
   */
  async reset(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS };
    await this.save();
  }

  /**
   * Merge stored settings with defaults (for backward compatibility)
   */
  private mergeSettings(
    defaults: MoonightSettings,
    stored: Partial<MoonightSettings>,
  ): MoonightSettings {
    return {
      ...defaults,
      ...stored,
      general: { ...defaults.general, ...stored.general },
      keybinds: { ...defaults.keybinds, ...stored.keybinds },
    };
  }
}
