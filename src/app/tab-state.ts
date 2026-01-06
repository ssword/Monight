import { buildFilterCSS } from '../scripts/filters';
import type { SliderManager } from '../scripts/sliders';
import type { TabData, TabManager } from '../scripts/tabs';
import { updateActivePresetButton } from './ui';

// Restore tab state (filters, page, zoom)
export async function restoreTabState(
  tabManager: TabManager | null,
  sliderManager: SliderManager | null,
  tab: TabData,
): Promise<void> {
  const viewer = tabManager?.getViewerForTab(tab.id);
  if (!viewer) return;

  // Apply saved filter
  viewer.applyFilter(buildFilterCSS(tab.filterSettings));

  // Restore page and zoom
  await viewer.goToPage(tab.currentPage);
  await viewer.setZoom(tab.zoom);

  // Update slider if initialized
  if (sliderManager?.isInitialized()) {
    sliderManager.setPreset(tab.filterSettings);
  }

  // Update preset button active state
  updateActivePresetButton(tab.filterSettings);
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

  // Save current filter if sliders initialized
  if (sliderManager?.isInitialized()) {
    activeTab.filterSettings = sliderManager.getCurrentSettings();
  }
}
