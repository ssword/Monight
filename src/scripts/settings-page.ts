import { SettingsManager } from './settings';
import type { MoonightSettings } from './settings';

// Initialize settings manager
const settingsManager = new SettingsManager();
let currentSettings: MoonightSettings;

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

  // Appearance settings
  const defaultDarkMode = document.getElementById('defaultDarkMode') as HTMLSelectElement;
  if (defaultDarkMode) defaultDarkMode.value = currentSettings.general.defaultDarkMode;

  // Render keybinds
  renderKeybinds();
}

// Save setting when changed
function setupSettingListeners(): void {
  // General settings
  const maximizeOnOpen = document.getElementById('maximizeOnOpen') as HTMLInputElement;
  maximizeOnOpen?.addEventListener('change', async () => {
    currentSettings.general.maximizeOnOpen = maximizeOnOpen.checked;
    await settingsManager.set('general', currentSettings.general);
  });

  const displayThumbs = document.getElementById('displayThumbs') as HTMLInputElement;
  displayThumbs?.addEventListener('change', async () => {
    currentSettings.general.displayThumbs = displayThumbs.checked;
    await settingsManager.set('general', currentSettings.general);
  });

  const rememberLastFilter = document.getElementById('rememberLastFilter') as HTMLInputElement;
  rememberLastFilter?.addEventListener('change', async () => {
    currentSettings.general.rememberLastFilter = rememberLastFilter.checked;
    await settingsManager.set('general', currentSettings.general);
  });

  // Appearance settings
  const defaultDarkMode = document.getElementById('defaultDarkMode') as HTMLSelectElement;
  defaultDarkMode?.addEventListener('change', async () => {
    currentSettings.general.defaultDarkMode = defaultDarkMode.value;
    await settingsManager.set('general', currentSettings.general);
  });

  // Reset settings button
  const resetButton = document.getElementById('reset-settings');
  resetButton?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all settings to default values?')) {
      await settingsManager.reset();
      currentSettings = await settingsManager.load();
      await loadSettings();
    }
  });
}

// Render keybinds
function renderKeybinds(): void {
  const container = document.getElementById('keybinds-container');
  if (!container) return;

  container.innerHTML = '';

  Object.entries(currentSettings.keybinds).forEach(([_id, config]) => {
    const keybindItem = document.createElement('div');
    keybindItem.className = 'keybind-item';

    const keybindHeader = document.createElement('div');
    keybindHeader.className = 'keybind-header';

    const keybindName = document.createElement('div');
    keybindName.className = 'keybind-name';
    keybindName.textContent = config.displayName;

    keybindHeader.appendChild(keybindName);

    const keybindKeys = document.createElement('div');
    keybindKeys.className = 'keybind-keys';

    config.binds.forEach((bind) => {
      const keyBadge = document.createElement('span');
      keyBadge.className = 'key-badge';
      keyBadge.textContent = bind.replace('CmdOrCtrl', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl');
      keybindKeys.appendChild(keyBadge);
    });

    keybindItem.appendChild(keybindHeader);
    keybindItem.appendChild(keybindKeys);
    container.appendChild(keybindItem);
  });
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
