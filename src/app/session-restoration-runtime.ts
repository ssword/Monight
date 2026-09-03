import type { ViewMode } from '../lib/document-features';
import type { RestoreDocumentResult } from '../reader/document-intake';
import type {
  ReadingSessionDocument,
  ReadingSessionVisualState,
  RestorableReadingPosition,
} from '../reader/reader-actions';
import type { FilterSettings } from '../scripts/filters';
import type { SliderManager } from '../scripts/sliders';
import type { TabData, TabManager } from '../scripts/tabs';
import { restoreTabState } from './tab-state';

export interface RestoreDocumentStateInTabManagerOptions {
  tabManager: TabManager;
  sliderManager: SliderManager | null;
  getInitialFilterSettings: () => FilterSettings;
  getInitialViewMode: () => ViewMode;
}

function cloneVisualState(
  visualState: ReadingSessionVisualState | undefined,
  getInitialFilterSettings: () => FilterSettings,
  getInitialViewMode: () => ViewMode,
): ReadingSessionVisualState {
  if (!visualState) {
    return {
      filterSettings: { ...getInitialFilterSettings() },
      zoomIntent: { kind: 'manual', scale: 1 },
      rotation: 0,
      viewMode: getInitialViewMode(),
    };
  }
  return {
    filterSettings: { ...visualState.filterSettings },
    zoomIntent:
      visualState.zoomIntent.kind === 'manual'
        ? { kind: 'manual', scale: visualState.zoomIntent.scale }
        : { kind: visualState.zoomIntent.kind },
    rotation: visualState.rotation,
    viewMode: visualState.viewMode,
  };
}

function readingPositionForRestore(
  tabManager: TabManager,
  tab: TabData,
  preserveCurrentReadingPosition: boolean,
  savedReadingPosition: RestorableReadingPosition,
): RestorableReadingPosition {
  if (!preserveCurrentReadingPosition) return savedReadingPosition;
  const currentReadingPosition = tabManager.getViewerForTab(tab.id)?.getReadingPosition();
  return currentReadingPosition ?? { page: tab.currentPage, legacyOffset: tab.scrollPosition };
}

export async function restoreDocumentStateInTabManager(
  {
    tabManager,
    sliderManager,
    getInitialFilterSettings,
    getInitialViewMode,
  }: RestoreDocumentStateInTabManagerOptions,
  document: ReadingSessionDocument,
  options: { preserveCurrentReadingPosition: boolean },
): Promise<RestoreDocumentResult> {
  const visualState = cloneVisualState(
    document.visualState,
    getInitialFilterSettings,
    getInitialViewMode,
  );
  const restoredTab = tabManager.getTabs().find((tab) => tab.filePath === document.filePath);
  if (!restoredTab) {
    return {
      status: 'failed',
      message: `Failed to restore ${document.filePath}: runtime did not create the Document.`,
    };
  }

  const readingPosition = readingPositionForRestore(
    tabManager,
    restoredTab,
    options.preserveCurrentReadingPosition,
    document.readingPosition,
  );
  restoredTab.title = document.title;
  restoredTab.filterSettings = { ...visualState.filterSettings };
  restoredTab.currentPage = readingPosition.page;
  restoredTab.zoomIntent = visualState.zoomIntent;
  restoredTab.zoom = visualState.zoomIntent.kind === 'manual' ? visualState.zoomIntent.scale : 1;
  restoredTab.rotation = visualState.rotation;
  restoredTab.scrollPosition =
    options.preserveCurrentReadingPosition || !('legacyOffset' in readingPosition)
      ? restoredTab.scrollPosition
      : readingPosition.legacyOffset;
  restoredTab.viewMode = visualState.viewMode;

  try {
    await restoreTabState(tabManager, sliderManager, restoredTab, readingPosition);
  } catch (error) {
    return {
      status: 'failed',
      message: `Failed to restore ${document.filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
  return { status: 'restored' };
}
