import type { FilterSettings } from '../scripts/filters';
import type { ReadingSession, SavedTabSession } from '../scripts/settings';
import type { SliderManager } from '../scripts/sliders';
import type { TabData, TabManager } from '../scripts/tabs';
import { openFiles } from './file-actions';
import { restoreTabState } from './tab-state';

export interface RestoreSessionResult {
  opened: number;
  failed: number;
}

interface RestoreSessionOptions {
  tabManager: TabManager;
  sliderManager: SliderManager | null;
  getInitialFilterSettings: () => FilterSettings;
  getInitialViewMode: () => 'single' | 'continuous';
}

function toSavedTabSession(tab: TabData): SavedTabSession {
  return {
    filePath: tab.filePath,
    title: tab.title,
    filterSettings: { ...tab.filterSettings },
    currentPage: tab.currentPage,
    zoom: tab.zoom,
    viewMode: tab.viewMode,
  };
}

export function captureReadingSession(tabManager: TabManager | null): ReadingSession {
  const activeTab = tabManager?.getActiveTab() ?? null;

  return {
    version: 1,
    activeFilePath: activeTab?.filePath ?? null,
    tabs: tabManager?.getTabs().map(toSavedTabSession) ?? [],
  };
}

async function restoreSavedTab(
  savedTab: SavedTabSession,
  {
    tabManager,
    sliderManager,
    getInitialFilterSettings,
    getInitialViewMode,
  }: RestoreSessionOptions,
): Promise<boolean> {
  const opened = await openFiles([savedTab.filePath], {
    tabManager,
    continueOnError: true,
    onError: (message) => console.warn(message),
    initialFilterSettings: savedTab.filterSettings ?? getInitialFilterSettings(),
    initialViewMode: savedTab.viewMode ?? getInitialViewMode(),
  });

  const restoredTab = tabManager.getTabs().find((tab) => tab.filePath === savedTab.filePath);

  if (opened === 0 || !restoredTab) {
    return false;
  }

  restoredTab.title = savedTab.title;
  restoredTab.filterSettings = { ...savedTab.filterSettings };
  restoredTab.currentPage = savedTab.currentPage;
  restoredTab.zoom = savedTab.zoom;
  restoredTab.viewMode = savedTab.viewMode;

  await restoreTabState(tabManager, sliderManager, restoredTab);
  return true;
}

export async function restoreReadingSession(
  session: ReadingSession,
  options: RestoreSessionOptions,
): Promise<RestoreSessionResult> {
  let opened = 0;
  let failed = 0;

  for (const savedTab of session.tabs) {
    const restored = await restoreSavedTab(savedTab, options);
    if (restored) {
      opened += 1;
    } else {
      failed += 1;
    }
  }

  if (session.activeFilePath) {
    const activeTab = options.tabManager
      .getTabs()
      .find((tab) => tab.filePath === session.activeFilePath);

    if (activeTab) {
      await options.tabManager.activateTab(activeTab.id);
    }
  }

  return { opened, failed };
}
