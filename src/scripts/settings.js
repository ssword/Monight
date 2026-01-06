import { Store } from '@tauri-apps/plugin-store';
/**
 * Default settings
 */
export const DEFAULT_SETTINGS = {
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
    constructor() {
        this.store = null;
        this.settings = { ...DEFAULT_SETTINGS };
    }
    /**
     * Initialize the store
     */
    async initStore() {
        if (!this.store) {
            this.store = await Store.load('settings.json');
        }
        return this.store;
    }
    /**
     * Load settings from persistent storage
     */
    async load() {
        try {
            const store = await this.initStore();
            const stored = await store.get('settings');
            if (stored && stored.version) {
                // Merge with defaults to handle new settings added in updates
                this.settings = this.mergeSettings(DEFAULT_SETTINGS, stored);
            }
            return this.settings;
        }
        catch (error) {
            console.error('Error loading settings:', error);
            return DEFAULT_SETTINGS;
        }
    }
    /**
     * Save settings to persistent storage
     */
    async save() {
        try {
            const store = await this.initStore();
            await store.set('settings', this.settings);
            await store.save();
        }
        catch (error) {
            console.error('Error saving settings:', error);
            throw error;
        }
    }
    /**
     * Get a specific setting value
     */
    get(key) {
        return this.settings[key];
    }
    /**
     * Set a specific setting value and save
     */
    async set(key, value) {
        this.settings[key] = value;
        await this.save();
    }
    /**
     * Get all settings
     */
    getAll() {
        return { ...this.settings };
    }
    /**
     * Update multiple settings at once
     */
    async updateMultiple(updates) {
        this.settings = { ...this.settings, ...updates };
        await this.save();
    }
    /**
     * Reset settings to defaults
     */
    async reset() {
        this.settings = { ...DEFAULT_SETTINGS };
        await this.save();
    }
    /**
     * Merge stored settings with defaults (for backward compatibility)
     */
    mergeSettings(defaults, stored) {
        return {
            ...defaults,
            ...stored,
            general: { ...defaults.general, ...stored.general },
            keybinds: { ...defaults.keybinds, ...stored.keybinds },
        };
    }
}
