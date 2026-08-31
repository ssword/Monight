import { viewModeIcon, viewModeLabel } from '../lib/document-features';
import { buildFilterCSS } from '../scripts/filters';
import type { SliderManager } from '../scripts/sliders';
import type { TabData, TabManager } from '../scripts/tabs';
import { updateActivePresetButton } from './ui';

// Restore tab state (filters, page, zoom, rotation, precise scroll position, view mode)
export async function restoreTabState(
  tabManager: TabManager | null,
  sliderManager: SliderManager | null,
  tab: TabData,
): Promise<void> {
  const viewer = tabManager?.getViewerForTab(tab.id);
  if (!viewer) return;

  // Apply saved filter
  viewer.applyFilter(buildFilterCSS(tab.filterSettings));

  // Apply geometry while still in single-page mode, then initialize the saved layout once.
  await viewer.setRotation(tab.rotation);
  await viewer.setZoom(tab.zoom);
  await viewer.setViewMode(tab.viewMode);
  await viewer.goToReadingPosition({ page: tab.currentPage, location: 0 });
  await viewer.setScrollPosition(tab.scrollPosition);

  // Update slider if initialized
  if (sliderManager?.isInitialized()) {
    sliderManager.setPreset(tab.filterSettings);
  }

  // Update preset button active state
  updateActivePresetButton(tab.filterSettings);

  // Update view mode button icon
  const icon = document.getElementById('view-mode-icon');
  if (icon) {
    icon.textContent = viewModeIcon(tab.viewMode);
    icon.parentElement?.setAttribute(
      'title',
      `${viewModeLabel(tab.viewMode)} (click to change view)`,
    );
  }
}

// Save current tab state
export function saveCurrentTabState(
  tabManager: TabManager | null,
  sliderManager: SliderManager | null,
): void {
  const activeTab = tabManager?.getActiveTab();
  if (!activeTab) return;

  const viewer = tabManager?.getViewerForTab(activeTab.id);
  if (!viewer) return;

  const state = viewer.getState();

  // Save state to tab
  activeTab.currentPage = state.currentPage;
  activeTab.zoom = state.zoom;
  activeTab.rotation = state.rotation;
  activeTab.scrollPosition = viewer.getScrollPosition();
  activeTab.viewMode = state.viewMode;

  // Save current filter if sliders initialized
  if (sliderManager?.isInitialized()) {
    activeTab.filterSettings = sliderManager.getCurrentSettings();
  }
}
