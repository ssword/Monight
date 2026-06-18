import { describe, expect, it } from 'vitest';
import { deriveScaledDimensions } from '../lib/dimensions';

describe('deriveScaledDimensions', () => {
  it('returns base dimensions at zoom=1 and rotation=0', () => {
    const result = deriveScaledDimensions({
      baseWidth: 612,
      baseHeight: 792,
      zoom: 1.0,
      rotation: 0,
    });

    expect(result.width).toBe(612);
    expect(result.height).toBe(792);
  });

  it('scales dimensions by zoom factor', () => {
    const result = deriveScaledDimensions({
      baseWidth: 612,
      baseHeight: 792,
      zoom: 2.0,
      rotation: 0,
    });

    expect(result.width).toBe(1224);
    expect(result.height).toBe(1584);
  });

  it('swaps width and height at 90° rotation', () => {
    const result = deriveScaledDimensions({
      baseWidth: 612,
      baseHeight: 792,
      zoom: 1.0,
      rotation: 90,
    });

    expect(result.width).toBe(792);
    expect(result.height).toBe(612);
  });

  it('swaps width and height at 270° rotation', () => {
    const result = deriveScaledDimensions({
      baseWidth: 612,
      baseHeight: 792,
      zoom: 1.5,
      rotation: 270,
    });

    expect(result.width).toBe(792 * 1.5);
    expect(result.height).toBe(612 * 1.5);
  });

  it('keeps width and height at 180° rotation', () => {
    const result = deriveScaledDimensions({
      baseWidth: 612,
      baseHeight: 792,
      zoom: 1.0,
      rotation: 180,
    });

    expect(result.width).toBe(612);
    expect(result.height).toBe(792);
  });
});
