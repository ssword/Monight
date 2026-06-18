import { describe, expect, it } from 'vitest';
import { computeSafeOutputScale } from '../lib/output-scale';

describe('computeSafeOutputScale', () => {
  it('keeps the device pixel ratio unchanged below the caps', () => {
    const scale = computeSafeOutputScale({
      devicePixelRatio: 2,
      viewportWidth: 600,
      viewportHeight: 800,
      maxArea: 4_000_000,
      maxDpr: 3,
    });

    expect(scale).toEqual({ sx: 2, sy: 2 });
  });

  it('reduces scale proportionally when the scaled canvas area exceeds the cap', () => {
    const scale = computeSafeOutputScale({
      devicePixelRatio: 4,
      viewportWidth: 1000,
      viewportHeight: 1000,
      maxArea: 4_000_000,
      maxDpr: 10,
    });

    expect(scale.sx).toBeCloseTo(2);
    expect(scale.sy).toBeCloseTo(2);
  });

  it('clamps the effective device pixel ratio to the configured ceiling', () => {
    const scale = computeSafeOutputScale({
      devicePixelRatio: 4,
      viewportWidth: 600,
      viewportHeight: 800,
      maxArea: 20_000_000,
      maxDpr: 2,
    });

    expect(scale).toEqual({ sx: 2, sy: 2 });
  });

  it('handles zero and very small viewport sizes without producing invalid scales', () => {
    const zeroWidthScale = computeSafeOutputScale({
      devicePixelRatio: 2,
      viewportWidth: 0,
      viewportHeight: 800,
      maxArea: 4_000_000,
      maxDpr: 3,
    });
    const tinyScale = computeSafeOutputScale({
      devicePixelRatio: 2,
      viewportWidth: 0.001,
      viewportHeight: 0.001,
      maxArea: 4_000_000,
      maxDpr: 3,
    });

    expect(zeroWidthScale).toEqual({ sx: 2, sy: 2 });
    expect(Number.isFinite(tinyScale.sx)).toBe(true);
    expect(Number.isFinite(tinyScale.sy)).toBe(true);
  });
});
