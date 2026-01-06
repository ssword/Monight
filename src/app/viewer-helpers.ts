import type { PDFViewer } from '../scripts/pdf-viewer';
import type { TabData, TabManager } from '../scripts/tabs';

export interface ActiveViewer {
  tab: TabData;
  viewer: PDFViewer;
}

export const getActiveViewer = (
  tabManager: TabManager | null,
): ActiveViewer | null => {
  if (!tabManager) return null;
  const tab = tabManager.getActiveTab();
  if (!tab) return null;
  const viewer = tabManager.getViewerForTab(tab.id);
  if (!viewer) return null;
  return { tab, viewer };
};

export const withActiveViewer = async (
  tabManager: TabManager | null,
  action: (viewer: PDFViewer, tab: TabData) => void | Promise<void>,
): Promise<void> => {
  const current = getActiveViewer(tabManager);
  if (!current) return;
  await action(current.viewer, current.tab);
};
