import type { ViewMode } from '../lib/document-features';
import type { FilterSettings } from '../scripts/filters';
import type { ReadingSession, SavedTabSession } from '../scripts/settings';
import type { SliderManager } from '../scripts/sliders';
import type { TabData, TabManager } from '../scripts/tabs';
import { openFiles } from './file-actions';
import { restoreTabState } from './tab-state';

export interface RestoreSessionResult {
  opened: number;
  failed: number;
  failedPaths: string[];
}

interface RestoreSessionOptions {
  tabManager: TabManager;
  sliderManager: SliderManager | null;
  getInitialFilterSettings: () => FilterSettings;
  getInitialViewMode: () => ViewMode;
  foregroundDocumentPath?: string | null;
}

function toSavedTabSession(tab: TabData): SavedTabSession {
  return {
    filePath: tab.filePath,
    title: tab.title,
    filterSettings: { ...tab.filterSettings },
    currentPage: tab.currentPage,
    zoom: tab.zoom,
    zoomIntent: tab.zoomIntent,
    rotation: tab.rotation,
    scrollPosition: tab.scrollPosition,
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
    foregroundDocumentPath,
  }: RestoreSessionOptions,
): Promise<boolean> {
  const existingTab = tabManager.getTabs().find((tab) => tab.filePath === savedTab.filePath);
  const opened = await openFiles([savedTab.filePath], {
    tabManager,
    continueOnError: true,
    onError: (message) => console.warn(message),
    initialFilterSettings: savedTab.filterSettings ?? getInitialFilterSettings(),
    initialViewMode: savedTab.viewMode ?? getInitialViewMode(),
  });

  const restoredTab = tabManager.getTabs().find((tab) => tab.filePath === savedTab.filePath);

  if (opened === 0 && !existingTab) {
    return false;
  }
  if (!restoredTab) {
    return false;
  }

  const preservePosition = savedTab.filePath === foregroundDocumentPath;
  const currentPage = restoredTab.currentPage;
  const currentScrollPosition = restoredTab.scrollPosition;
  restoredTab.title = savedTab.title;
  restoredTab.filterSettings = { ...savedTab.filterSettings };
  restoredTab.currentPage = preservePosition ? currentPage : savedTab.currentPage;
  restoredTab.zoom = savedTab.zoom;
  restoredTab.zoomIntent = savedTab.zoomIntent ?? { kind: 'manual', scale: savedTab.zoom };
  restoredTab.rotation = savedTab.rotation ?? 0;
  restoredTab.scrollPosition = preservePosition
    ? currentScrollPosition
    : (savedTab.scrollPosition ?? 0);
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
  const failedPaths: string[] = [];
  const savedActive = session.tabs.find((tab) => tab.filePath === session.activeFilePath);
  const restoreOrder = savedActive
    ? [savedActive, ...session.tabs.filter((tab) => tab !== savedActive)]
    : session.tabs;

  for (const savedTab of restoreOrder) {
    const restored = await restoreSavedTab(savedTab, options);
    if (restored) {
      opened += 1;
    } else {
      failed += 1;
      failedPaths.push(savedTab.filePath);
    }
    if (options.foregroundDocumentPath && savedTab.filePath !== options.foregroundDocumentPath) {
      const foreground = options.tabManager
        .getTabs()
        .find((tab) => tab.filePath === options.foregroundDocumentPath);
      if (foreground) await options.tabManager.activateTab(foreground.id);
    }
  }

  if (options.foregroundDocumentPath) {
    const foreground = options.tabManager
      .getTabs()
      .find((tab) => tab.filePath === options.foregroundDocumentPath);
    if (foreground) await options.tabManager.activateTab(foreground.id);
  } else if (session.activeFilePath) {
    const activeTab = options.tabManager
      .getTabs()
      .find((tab) => tab.filePath === session.activeFilePath);

    if (activeTab) {
      await options.tabManager.activateTab(activeTab.id);
    }
  }

  return { opened, failed, failedPaths };
}
