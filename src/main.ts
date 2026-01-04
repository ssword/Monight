import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import './styles/main.css';

interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
}

async function getAppInfo(): Promise<AppInfo> {
  try {
    const name = 'Monight (墨页)';
    const version = '1.0.0';
    const tauriVersion = '2.0';

    return { name, version, tauriVersion };
  } catch (error) {
    console.error('Failed to get app info:', error);
    return { name: 'Monight', version: '1.0.0', tauriVersion: 'Unknown' };
  }
}

async function initializeApp(): Promise<void> {
  try {
    // Get app information
    const info = await getAppInfo();

    // Update version display
    const versionElement = document.getElementById('version-info');
    if (versionElement) {
      versionElement.textContent = `v${info.version} • Tauri ${info.tauriVersion}`;
    }

    // Get current window
    const currentWindow = getCurrentWebviewWindow();

    // Show window after initialization
    await currentWindow.show();
    await currentWindow.setFocus();

    console.log(`${info.name} initialized successfully!`);
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
