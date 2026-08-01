import {
  viewModeIcon as getViewModeIcon,
  type RecentFile,
  viewModeLabel,
} from '../lib/document-features';
import { type FilterSettings, PRESETS } from '../scripts/filters';
import type { TabManager } from '../scripts/tabs';

// Show splash screen
export function showSplash(): void {
  const splash = document.getElementById('splash-container');
  const viewer = document.getElementById('viewer-container');
  if (splash) splash.classList.remove('hidden');
  if (viewer) viewer.classList.add('hidden');
}

// Show PDF viewer
export function showViewer(): void {
  const splash = document.getElementById('splash-container');
  const viewer = document.getElementById('viewer-container');
  if (splash) splash.classList.add('hidden');
  if (viewer) viewer.classList.remove('hidden');
}

export function renderRecentFiles(recentFiles: readonly RecentFile[]): void {
  const section = document.getElementById('recent-files-section');
  const list = document.getElementById('recent-files-list');
  if (!section || !list) return;

  section.classList.toggle('hidden', recentFiles.length === 0);
  list.replaceChildren();

  for (const recent of recentFiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-file-button';
    button.dataset.filePath = recent.filePath;
    button.title = recent.filePath;

    const title = document.createElement('span');
    title.className = 'recent-file-title';
    title.textContent = recent.title;
    const path = document.createElement('span');
    path.className = 'recent-file-path';
    path.textContent = recent.filePath;
    button.append(title, path);
    list.appendChild(button);
  }
}

// Update tab bar visibility
export function updateTabBarVisibility(tabManager: TabManager | null): void {
  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;

  const hasTab = (tabManager?.size ?? 0) > 0;

  if (hasTab) {
    tabBar.classList.remove('hidden');
  } else {
    tabBar.classList.add('hidden');
  }
}

// Update active preset button based on settings
export function updateActivePresetButton(settings: FilterSettings): void {
  const buttons = document.querySelectorAll('.preset-btn');

  // Check if settings match any preset
  let matchedPreset: string | null = null;

  for (const [presetName, presetSettings] of Object.entries(PRESETS)) {
    if (JSON.stringify(presetSettings) === JSON.stringify(settings)) {
      matchedPreset = presetName;
      break;
    }
  }

  // Update button states
  buttons.forEach((btn) => {
    const presetName = btn.id.replace('preset-', '');
    if (presetName === matchedPreset) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Update UI based on viewer state
export function updateUI(tabManager: TabManager | null): void {
  const activeTab = tabManager?.getActiveTab();
  if (!activeTab) return;

  const viewer = tabManager?.getViewerForTab(activeTab.id);
  if (!viewer) return;

  const state = viewer.getState();

  // Update page info
  const pageInput = document.getElementById('page-input') as HTMLInputElement;
  const pageCount = document.getElementById('page-count');
  if (pageInput) {
    pageInput.value = state.currentPage.toString();
    pageInput.max = state.totalPages.toString();
  }
  if (pageCount) {
    pageCount.textContent = state.totalPages.toString();
  }

  // Update zoom info
  const zoomInfo = document.getElementById('zoom-info');
  if (zoomInfo) {
    zoomInfo.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  // Update file name
  const fileName = document.getElementById('file-name');
  if (fileName) {
    fileName.textContent = activeTab.title || 'No file loaded';
  }

  // Update view mode icon
  const viewModeIcon = document.getElementById('view-mode-icon');
  if (viewModeIcon) {
    viewModeIcon.textContent = getViewModeIcon(state.viewMode);
    viewModeIcon.parentElement?.setAttribute(
      'title',
      `${viewModeLabel(state.viewMode)} (click to change view)`,
    );
  }

  // Update button states
  const prevBtn = document.getElementById('prev-page') as HTMLButtonElement;
  const nextBtn = document.getElementById('next-page') as HTMLButtonElement;
  if (prevBtn) {
    prevBtn.disabled = state.currentPage <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = state.currentPage >= state.totalPages;
  }
}

// Update keyboard shortcut hints based on platform
export function updateKeyboardHints(isMac: boolean): void {
  const modKey = isMac ? 'Cmd' : 'Ctrl';

  // Update tooltips
  const openBtn = document.getElementById('open-file');
  if (openBtn) openBtn.title = `Open PDF (${modKey}+O)`;

  const printBtn = document.getElementById('print-file');
  if (printBtn) printBtn.title = `Print (${modKey}+P)`;

  const zoomInBtn = document.getElementById('zoom-in');
  if (zoomInBtn) zoomInBtn.title = `Zoom In (${modKey}++)`;

  const zoomOutBtn = document.getElementById('zoom-out');
  if (zoomOutBtn) zoomOutBtn.title = `Zoom Out (${modKey}+-)`;

  // Update hint text
  const hintText = document.querySelector('.hint-text');
  if (hintText) hintText.textContent = `Press ${modKey}+O to open a PDF file`;
}
