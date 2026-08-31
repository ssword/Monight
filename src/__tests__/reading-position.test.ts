import { describe, expect, it } from 'vitest';
import { captureReadingPosition, restoreReadingPosition } from '../reader/reading-position';

describe('Reading Position', () => {
  it('restores the same normalized page location after viewport geometry changes', () => {
    const position = captureReadingPosition({
      pageOffsets: [0, 20, 1020, 2020, 3040],
      pageHeights: [980, 980, 1000],
      scrollTop: 1350,
      pagePadding: 20,
    });

    expect(position).toEqual({ page: 2, location: 0.35714285714285715 });
    expect(
      restoreReadingPosition(position, {
        pageOffsets: [0, 20, 620, 1220, 1840],
        pageHeights: [580, 580, 600],
        pagePadding: 20,
      }),
    ).toBeCloseTo(807.1428571428571);
  });
});
