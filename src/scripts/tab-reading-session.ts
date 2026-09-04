import type {
  ReadingSessionVisualState,
  RestorableReadingPosition,
  ZoomIntent,
} from '../reader/reader-actions';
import { buildFilterCSS } from './filters';
import type { PDFViewer } from './pdf-viewer';
import type { TabData } from './tabs';

export interface ProjectedDocumentState {
  title?: string;
  readingPosition: RestorableReadingPosition;
  visualState?: ReadingSessionVisualState;
}

function cloneZoomIntent(zoomIntent: ZoomIntent): ZoomIntent {
  return zoomIntent.kind === 'manual'
    ? { kind: 'manual', scale: zoomIntent.scale }
    : { kind: zoomIntent.kind };
}

export function applyProjectedDocumentStateToTab(
  tab: TabData,
  { title, readingPosition, visualState }: ProjectedDocumentState,
): void {
  if (title !== undefined) tab.title = title;
  tab.currentPage = readingPosition.page;
  if ('legacyOffset' in readingPosition) {
    tab.scrollPosition = readingPosition.legacyOffset;
  }
  if (!visualState) return;
  tab.filterSettings = { ...visualState.filterSettings };
  tab.zoomIntent = cloneZoomIntent(visualState.zoomIntent);
  tab.zoom = visualState.zoomIntent.kind === 'manual' ? visualState.zoomIntent.scale : 1;
  tab.rotation = visualState.rotation;
  tab.viewMode = visualState.viewMode;
}

export async function projectTabStateToViewer(
  viewer: PDFViewer,
  tab: TabData,
  readingPosition: RestorableReadingPosition,
): Promise<void> {
  viewer.applyFilter(buildFilterCSS(tab.filterSettings));
  await viewer.setRotation(tab.rotation);
  await viewer.setViewMode(tab.viewMode);
  await viewer.setZoomIntent(tab.zoomIntent);
  await viewer.goToReadingPosition(readingPosition);
}
