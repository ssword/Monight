import type { ReadingSession, SavedTabSession } from '../scripts/settings';
import type { TabData, TabManager } from '../scripts/tabs';

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
    readingPosition: { page: tab.currentPage, legacyOffset: tab.scrollPosition },
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
