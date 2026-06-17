/**
 * Constant-time scroll geometry functions for continuous-scroll PDF viewing.
 *
 * These pure functions replace linear-scan geometry calculations with
 * O(1) lookups and O(log n) binary searches using a precomputed
 * cumulative page-offset array (prefix sum).
 *
 * All page indices are 1-based to match PDF.js conventions.
 * The offset array has a sentinel at index 0 (= 0),
 * so offsets[pageNum] gives the y-position of page pageNum's top edge.
 * offsets[pageCount + 1] gives the total scroll height.
 */

/**
 * Build a cumulative page-offset array from page heights, inter-page gap, and padding.
 *
 * @param pageHeights - Array of page heights (0-indexed: pageHeights[0] = height of page 1)
 * @param gap - Pixel gap between consecutive pages
 * @param padding - Top and bottom padding around all pages
 * @returns Offset array where offsets[i] (1-based) = y-position of page i's top edge,
 *          and offsets[pageCount + 1] = total scroll height
 */
export function buildOffsetArray(pageHeights: number[], gap: number, padding: number): number[] {
  const pageCount = pageHeights.length;
  // offsets[0] = sentinel, offsets[1..n] = page tops, offsets[n+1] = total height
  const offsets = new Array<number>(pageCount + 2);
  offsets[0] = 0;
  offsets[1] = padding;

  for (let i = 1; i < pageCount; i++) {
    offsets[i + 1] = offsets[i] + pageHeights[i - 1] + gap;
  }

  // Total height: last page bottom + bottom padding
  offsets[pageCount + 1] = offsets[pageCount] + pageHeights[pageCount - 1] + padding;

  return offsets;
}

/**
 * Get the y-position of a page's top edge in O(1).
 *
 * @param offsets - Precomputed offset array from buildOffsetArray
 * @param pageNum - 1-based page number
 * @returns Y-position in pixels of the page's top edge
 */
export function positionAtPage(offsets: number[], pageNum: number): number {
  return offsets[pageNum];
}

/**
 * Find the range of visible pages using binary search over the offset array.
 *
 * A page is "visible" if any part of it falls within the viewport
 * (scrollTop..scrollTop+viewportHeight), expanded by buffer on both sides.
 *
 * @param offsets - Precomputed offset array from buildOffsetArray
 * @param scrollTop - Current scroll position in pixels
 * @param viewportHeight - Height of the visible viewport in pixels
 * @param buffer - Extra pixels to extend the visible area on each side
 * @returns [startPage, endPage] — 1-based inclusive page range
 */
export function visiblePageRange(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  buffer: number,
): [number, number] {
  const pageCount = offsets.length - 2; // offsets has pageCount + 2 entries
  if (pageCount <= 0) return [1, 1];

  const visibleTop = scrollTop - buffer;
  const visibleBottom = scrollTop + viewportHeight + buffer;

  // Binary search for the first page whose bottom edge (= top of next page) > visibleTop
  // i.e., find smallest pageNum where offsets[pageNum + 1] > visibleTop
  let lo = 1;
  let hi = pageCount;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid + 1] <= visibleTop) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const startPage = lo;

  // Binary search for the last page whose top edge < visibleBottom
  // i.e., find largest pageNum where offsets[pageNum] < visibleBottom
  lo = startPage;
  hi = pageCount;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (offsets[mid] < visibleBottom) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const endPage = lo;

  return [startPage, endPage];
}

/**
 * Determine which page is at a given focus position using binary search.
 *
 * For positions in the gap between pages, returns the preceding page.
 * Clamps to valid page range (1..pageCount).
 *
 * @param offsets - Precomputed offset array from buildOffsetArray
 * @param focusPosition - Y-position in pixels to find the page for
 * @returns 1-based page number
 */
export function currentPageAt(offsets: number[], focusPosition: number): number {
  const pageCount = offsets.length - 2;
  if (pageCount <= 0) return 1;

  // Binary search: find the largest pageNum where offsets[pageNum] <= focusPosition
  let lo = 1;
  let hi = pageCount;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (offsets[mid] <= focusPosition) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}
