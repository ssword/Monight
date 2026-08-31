import { currentPageAt } from '../lib/scroll-geometry';
import type { ReadingPosition } from './reader-actions';

interface ReadingGeometry {
  pageOffsets: number[];
  pageHeights: number[];
  pagePadding: number;
}

interface CaptureReadingGeometry extends ReadingGeometry {
  scrollTop: number;
}

export function captureReadingPosition({
  pageOffsets,
  pageHeights,
  scrollTop,
  pagePadding,
}: CaptureReadingGeometry): ReadingPosition {
  const focus = Math.max(0, scrollTop) + pagePadding;
  const page = currentPageAt(pageOffsets, focus);
  const pageTop = pageOffsets[page] ?? pagePadding;
  const pageHeight = pageHeights[page - 1] ?? 0;
  const location = pageHeight > 0 ? Math.min(1, Math.max(0, (focus - pageTop) / pageHeight)) : 0;
  return { page, location };
}

export function restoreReadingPosition(
  position: ReadingPosition,
  { pageOffsets, pageHeights, pagePadding }: ReadingGeometry,
): number {
  const page = Math.min(Math.max(position.page, 1), pageHeights.length);
  const pageTop = pageOffsets[page] ?? pagePadding;
  const pageHeight = pageHeights[page - 1] ?? 0;
  const location = Math.min(1, Math.max(0, position.location));
  return Math.max(0, pageTop + pageHeight * location - pagePadding);
}
