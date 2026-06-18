import { describe, expect, it } from 'vitest';
import {
  buildOffsetArray,
  currentPageAt,
  positionAtPage,
  visiblePageRange,
} from '../lib/scroll-geometry';

describe('buildOffsetArray', () => {
  it('builds correct offsets for uniform page heights', () => {
    // 3 pages, each 100px tall, gap=10, padding=20
    const offsets = buildOffsetArray([100, 100, 100], 10, 20);

    // offsets[0] = sentinel (should never be used for positioning, but exists)
    // offsets[1] = padding = 20 (top of page 1)
    // offsets[2] = 20 + 100 + 10 = 130 (top of page 2)
    // offsets[3] = 130 + 100 + 10 = 240 (top of page 3)
    // offsets[4] = 240 + 100 + 20 = 360 (total height: last page bottom + padding)
    expect(offsets).toEqual([0, 20, 130, 240, 360]);
  });

  it('builds correct offsets for varied page heights', () => {
    // 3 pages with heights [200, 150, 300], gap=5, padding=10
    const offsets = buildOffsetArray([200, 150, 300], 5, 10);

    // offsets[1] = 10 (padding)
    // offsets[2] = 10 + 200 + 5 = 215
    // offsets[3] = 215 + 150 + 5 = 370
    // offsets[4] = 370 + 300 + 10 = 680 (total height)
    expect(offsets).toEqual([0, 10, 215, 370, 680]);
  });

  it('handles a single page', () => {
    const offsets = buildOffsetArray([500], 10, 20);

    // offsets[1] = 20 (padding)
    // offsets[2] = 20 + 500 + 20 = 540 (total height)
    expect(offsets).toEqual([0, 20, 540]);
  });

  it('handles zero gap and zero padding', () => {
    const offsets = buildOffsetArray([100, 200], 0, 0);

    // offsets[1] = 0
    // offsets[2] = 0 + 100 + 0 = 100
    // offsets[3] = 100 + 200 + 0 = 300 (total height)
    expect(offsets).toEqual([0, 0, 100, 300]);
  });
});

describe('positionAtPage', () => {
  // Shared offsets: 3 pages, heights [100, 100, 100], gap=10, padding=20
  // offsets = [0, 20, 130, 240, 360]
  const offsets = [0, 20, 130, 240, 360];

  it('returns the top position of the first page', () => {
    expect(positionAtPage(offsets, 1)).toBe(20);
  });

  it('returns the top position of a middle page', () => {
    expect(positionAtPage(offsets, 2)).toBe(130);
  });

  it('returns the top position of the last page', () => {
    expect(positionAtPage(offsets, 3)).toBe(240);
  });
});

describe('visiblePageRange', () => {
  // 5 pages, each 200px tall, gap=10, padding=20
  // offsets[1] = 20,   offsets[2] = 230,  offsets[3] = 440,
  // offsets[4] = 650,  offsets[5] = 860,  offsets[6] = 1080 (total height)
  const offsets = buildOffsetArray([200, 200, 200, 200, 200], 10, 20);

  it('returns first pages when scrolled to top', () => {
    // scrollTop=0, viewportHeight=300, buffer=0
    // Visible area: 0..300
    // Page 1: top=20, bottom=220 — visible
    // Page 2: top=230, bottom=430 — partially visible
    // Page 3: top=440 — not visible
    const [start, end] = visiblePageRange(offsets, 0, 300, 0);
    expect(start).toBe(1);
    expect(end).toBe(2);
  });

  it('returns middle pages at mid-scroll', () => {
    // scrollTop=400, viewportHeight=300, buffer=0
    // Visible area: 400..700
    // Page 2: top=230, bottom=430 — partially visible
    // Page 3: top=440, bottom=640 — visible
    // Page 4: top=650, bottom=850 — partially visible
    const [start, end] = visiblePageRange(offsets, 400, 300, 0);
    expect(start).toBe(2);
    expect(end).toBe(4);
  });

  it('returns last pages when scrolled to bottom', () => {
    // scrollTop=800, viewportHeight=300, buffer=0
    // Visible area: 800..1100
    // Page 4: top=650, bottom=860 — partially visible (bottom edge in viewport)
    // Page 5: top=860, bottom=1060 — visible
    const [start, end] = visiblePageRange(offsets, 800, 300, 0);
    expect(start).toBe(4);
    expect(end).toBe(5);
  });

  it('expands range with buffer', () => {
    // scrollTop=400, viewportHeight=300, buffer=250
    // Effective visible: 150..950
    // Page 1: top=20, bottom=220 — in range
    // Page 5: top=860, bottom=1060 — in range
    const [start, end] = visiblePageRange(offsets, 400, 300, 250);
    expect(start).toBe(1);
    expect(end).toBe(5);
  });

  it('clamps to valid page range when scrolled past end', () => {
    const [start, end] = visiblePageRange(offsets, 2000, 300, 0);
    // Should return valid range (at minimum the last page, or empty)
    expect(start).toBeGreaterThanOrEqual(1);
    expect(end).toBeLessThanOrEqual(5);
  });
});

describe('currentPageAt', () => {
  // 5 pages, each 200px tall, gap=10, padding=20
  // offsets = [0, 20, 230, 440, 650, 860, 1080]
  const offsets = buildOffsetArray([200, 200, 200, 200, 200], 10, 20);

  it('returns page 1 when focus is within page 1', () => {
    // Page 1 spans 20..220
    expect(currentPageAt(offsets, 50)).toBe(1);
  });

  it('returns page 1 when focus is before page 1 (in padding)', () => {
    expect(currentPageAt(offsets, 10)).toBe(1);
  });

  it('returns correct page when focus is at exact page boundary', () => {
    // Page 2 starts at 230
    expect(currentPageAt(offsets, 230)).toBe(2);
  });

  it('returns correct page for mid-document position', () => {
    // Page 3 spans 440..640
    expect(currentPageAt(offsets, 500)).toBe(3);
  });

  it('returns last page when focus is past the last page', () => {
    expect(currentPageAt(offsets, 2000)).toBe(5);
  });

  it('returns page in gap between pages', () => {
    // Gap between page 2 and 3: 430..440
    // Position 435 is in the gap — should return page 2 (the page whose area we just left)
    expect(currentPageAt(offsets, 435)).toBe(2);
  });
});
