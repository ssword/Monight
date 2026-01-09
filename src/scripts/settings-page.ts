import { SettingsManager, type KeybindConfig } from './settings';
import type { MoonightSettings } from './settings';
import { KeybindManager } from './keybind-manager';
import { KeybindEditor } from './keybind-editor';
import { emit } from '@tauri-apps/api/event';

// Initialize settings manager
const settingsManager = new SettingsManager();
let currentSettings: MoonightSettings;

// Detect platform
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

// Initialize keybind manager and editor
const keybindManager = new KeybindManager(isMac);
let keybindEditor: KeybindEditor | null = null;

// Switch between settings panels
function initializePanelSwitching(): void {
  const sidebarItems = document.querySelectorAll('.sidebar-item');
  const panels = document.querySelectorAll('.settings-panel');

  sidebarItems.forEach((item) => {
    item.addEventListener('click', () => {
      const panelId = item.getAttribute('data-panel');
      if (!panelId) return;

      // Update active states
      sidebarItems.forEach((i) => i.classList.remove('active'));
      item.classList.add('active');

      panels.forEach((panel) => {
        if (panel.id === `panel-${panelId}`) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      });
    });
  });
}

// Load and display settings
async function loadSettings(): Promise<void> {
  currentSettings = await settingsManager.load();

  // General settings
  const maximizeOnOpen = document.getElementById('maximizeOnOpen') as HTMLInputElement;
  if (maximizeOnOpen) maximizeOnOpen.checked = currentSettings.general.maximizeOnOpen;

  const displayThumbs = document.getElementById('displayThumbs') as HTMLInputElement;
  if (displayThumbs) displayThumbs.checked = currentSettings.general.displayThumbs;

  const rememberLastFilter = document.getElementById('rememberLastFilter') as HTMLInputElement;
  if (rememberLastFilter)
    rememberLastFilter.checked = currentSettings.general.rememberLastFilter;

  const defaultContinuousScroll = document.getElementById(
    'defaultContinuousScroll',
  ) as HTMLInputElement;
  if (defaultContinuousScroll)
    defaultContinuousScroll.checked = currentSettings.general.defaultViewMode === 'continuous';

  // Appearance settings
  const defaultDarkMode = document.getElementById('defaultDarkMode') as HTMLSelectElement;
  if (defaultDarkMode) defaultDarkMode.value = currentSettings.general.defaultDarkMode;

  // Render keybinds
  renderKeybinds();
}

// Notify main window that settings have changed
async function notifyMainSettingsChanged(): Promise<void> {
  try {
    await emit('settings-changed');
    console.log('Emitted settings-changed event to main window');
  } catch (error) {
    console.error('Error emitting settings-changed event:', error);
  }
}

// Save setting when changed
function setupSettingListeners(): void {
  // General settings
  const maximizeOnOpen = document.getElementById('maximizeOnOpen') as HTMLInputElement;
  maximizeOnOpen?.addEventListener('change', async () => {
    currentSettings.general.maximizeOnOpen = maximizeOnOpen.checked;
    await settingsManager.set('general', currentSettings.general);
    await notifyMainSettingsChanged();
  });

  const displayThumbs = document.getElementById('displayThumbs') as HTMLInputElement;
  displayThumbs?.addEventListener('change', async () => {
    currentSettings.general.displayThumbs = displayThumbs.checked;
    await settingsManager.set('general', currentSettings.general);
    await notifyMainSettingsChanged();
  });

  const rememberLastFilter = document.getElementById('rememberLastFilter') as HTMLInputElement;
  rememberLastFilter?.addEventListener('change', async () => {
    currentSettings.general.rememberLastFilter = rememberLastFilter.checked;
    await settingsManager.set('general', currentSettings.general);
    await notifyMainSettingsChanged();
  });

  const defaultContinuousScroll = document.getElementById(
    'defaultContinuousScroll',
  ) as HTMLInputElement;
  defaultContinuousScroll?.addEventListener('change', async () => {
    currentSettings.general.defaultViewMode = defaultContinuousScroll.checked
      ? 'continuous'
      : 'single';
    await settingsManager.set('general', currentSettings.general);
    await notifyMainSettingsChanged();
  });

  // Appearance settings
  const defaultDarkMode = document.getElementById('defaultDarkMode') as HTMLSelectElement;
  defaultDarkMode?.addEventListener('change', async () => {
    currentSettings.general.defaultDarkMode = defaultDarkMode.value;
    await settingsManager.set('general', currentSettings.general);
    await notifyMainSettingsChanged();
  });

  // Reset settings button
  const resetButton = document.getElementById('reset-settings');
  resetButton?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all settings to default values?')) {
      await settingsManager.reset();
      currentSettings = await settingsManager.load();
      await loadSettings();
      await notifyMainKeybindsChanged();
      await notifyMainSettingsChanged();
    }
  });
}

// Render keybinds
function renderKeybinds(): void {
  const container = document.getElementById('keybinds-container');
  if (!container) return;

  container.innerHTML = '';

  Object.entries(currentSettings.keybinds).forEach(([actionId, config]) => {
    const keybindItem = document.createElement('div');
    keybindItem.className = 'keybind-item';

    // Header with name and edit button
    const keybindHeader = document.createElement('div');
    keybindHeader.className = 'keybind-header';

    const keybindName = document.createElement('div');
    keybindName.className = 'keybind-name';
    keybindName.textContent = config.displayName;

    const editButton = document.createElement('button');
    editButton.className = 'btn btn-secondary btn-sm';
    editButton.textContent = 'Edit';
    editButton.onclick = () => startEditingKeybind(actionId, config);

    keybindHeader.appendChild(keybindName);
    keybindHeader.appendChild(editButton);

    // Keybinds display
    const keybindKeys = document.createElement('div');
    keybindKeys.className = 'keybind-keys';

    if (config.binds.length === 0) {
      const noneBadge = document.createElement('span');
      noneBadge.className = 'key-badge none';
      noneBadge.textContent = 'None';
      keybindKeys.appendChild(noneBadge);
    } else {
      config.binds.forEach((bind, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'key-badge-wrapper';

        const keyBadge = document.createElement('span');
        keyBadge.className = 'key-badge';
        keyBadge.textContent = formatKeybindForDisplay(bind);
        keyBadge.style.cursor = 'pointer';
        keyBadge.onclick = () => startEditingKeybind(actionId, config, index);

        // Remove button for this binding
        const removeBtn = document.createElement('button');
        removeBtn.className = 'keybind-remove';
        removeBtn.innerHTML = '×';
        removeBtn.title = 'Remove this keybind';
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          removeKeybind(actionId, index);
        };

        wrapper.appendChild(keyBadge);
        wrapper.appendChild(removeBtn);
        keybindKeys.appendChild(wrapper);
      });

      // Add binding button
      const addBtn = document.createElement('button');
      addBtn.className = 'keybind-add';
      addBtn.textContent = '+ Add binding';
      addBtn.onclick = () => addKeybind(actionId);
      keybindKeys.appendChild(addBtn);
    }

    keybindItem.appendChild(keybindHeader);
    keybindItem.appendChild(keybindKeys);
    container.appendChild(keybindItem);
  });
}

// Format keybind for display
function formatKeybindForDisplay(bind: string): string {
  return bind
    .replace('CmdOrCtrl', isMac ? 'Cmd' : 'Ctrl')
    .replace(/\+/g, ' + ')
    .replace('Plus', '+')
    .replace('Minus', '-')
    .replace('ArrowRight', '→')
    .replace('ArrowLeft', '←')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓');
}

// Start editing a keybind
function startEditingKeybind(actionId: string, config: KeybindConfig, bindIndex: number = 0): void {
  if (!keybindEditor) {
    keybindEditor = new KeybindEditor(keybindManager, currentSettings, isMac);
  }

  const currentBind = config.binds[bindIndex] || '';

  keybindEditor.startRecording(
    currentBind,
    async (newKeybind) => {
      // Check for conflicts
      const conflict = keybindEditor?.findConflict(newKeybind, actionId);
      if (conflict) {
        const confirmed = confirm(
          `This key combination is already used for "${conflict.displayName}".\n\n` +
          `Do you want to replace it?`
        );

        if (!confirmed) return;

        // Clear the conflicting keybind
        currentSettings.keybinds[conflict.actionId].binds =
          currentSettings.keybinds[conflict.actionId].binds.filter(b => b !== newKeybind);
      }

      // Update settings
      if (config.binds[bindIndex]) {
        config.binds[bindIndex] = newKeybind;
      } else {
        config.binds.push(newKeybind);
      }

      await settingsManager.set('keybinds', currentSettings.keybinds);
      renderKeybinds();

      // Notify main window to reload keybinds
      notifyMainKeybindsChanged();
    },
    () => {
      // Cancelled - do nothing
    }
  );
}

// Remove a keybind
async function removeKeybind(actionId: string, index: number): Promise<void> {
  currentSettings.keybinds[actionId].binds.splice(index, 1);
  await settingsManager.set('keybinds', currentSettings.keybinds);
  renderKeybinds();
  notifyMainKeybindsChanged();
}

// Add a new keybind
function addKeybind(actionId: string): void {
  if (!keybindEditor) {
    keybindEditor = new KeybindEditor(keybindManager, currentSettings, isMac);
  }

  keybindEditor.startRecording(
    '',
    async (newKeybind) => {
      // Check for conflicts
      const conflict = keybindEditor?.findConflict(newKeybind, actionId);
      if (conflict) {
        const confirmed = confirm(
          `This key combination is already used for "${conflict.displayName}".\n\n` +
          `Do you want to replace it?`
        );

        if (!confirmed) return;

        // Clear the conflicting keybind
        currentSettings.keybinds[conflict.actionId].binds =
          currentSettings.keybinds[conflict.actionId].binds.filter(b => b !== newKeybind);
      }

      // Add new binding
      currentSettings.keybinds[actionId].binds.push(newKeybind);
      await settingsManager.set('keybinds', currentSettings.keybinds);
      renderKeybinds();
      notifyMainKeybindsChanged();
    },
    () => {}
  );
}

// Notify main window that keybinds have changed
async function notifyMainKeybindsChanged(): Promise<void> {
  try {
    // Emit event to main window to reload keybinds
    await emit('keybinds-changed');
    console.log('Emitted keybinds-changed event to main window');
  } catch (error) {
    console.error('Error emitting keybinds-changed event:', error);
  }
}

// Initialize settings page
async function init(): Promise<void> {
  console.log('Initializing settings page...');

  // Setup panel switching
  initializePanelSwitching();

  // Load settings
  await loadSettings();

  // Setup event listeners
  setupSettingListeners();

  console.log('Settings page initialized!');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
