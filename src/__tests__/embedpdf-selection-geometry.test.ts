import { describe, expect, it } from 'vitest';
import { inkSelectionGeometry } from '../app/embedpdf-selection-geometry';

describe('selection ink bounds', () => {
  it('keeps advances and whitespace while using measured glyph heights', () => {
    const geometry = {
      runs: [
        {
          charStart: 0,
          fontSize: 24,
          rect: { x: 72, y: 46, width: 55, height: 38 },
          glyphs: [
            { x: 72, y: 46, width: 14, height: 38, flags: 0, tightY: 59, tightHeight: 13 },
            { x: 86, y: 46, width: 7, height: 38, flags: 1, tightY: 72, tightHeight: 0 },
            { x: 93, y: 46, width: 14, height: 38, flags: 0, tightY: 59, tightHeight: 18 },
          ],
        },
      ],
    };
    const result = inkSelectionGeometry(geometry);
    expect(
      result.runs[0].glyphs.map(({ x, width, y, height }) => ({ x, width, y, height })),
    ).toEqual([
      { x: 72, width: 14, y: 57, height: 17 },
      { x: 86, width: 7, y: 57, height: 17 },
      { x: 93, width: 14, y: 57, height: 22 },
    ]);
    expect(result.runs[0].rect).toEqual({ x: 72, y: 57, width: 55, height: 22 });
    expect(geometry.runs[0].glyphs[0].height).toBe(38);
  });

  it('retains fallback geometry when the engine has no usable ink bounds', () => {
    const run = {
      charStart: 0,
      rect: { x: 0, y: 0, width: 20, height: 20 },
      glyphs: [
        { x: 0, y: 0, width: 20, height: 20, flags: 0 },
        { x: 0, y: 0, width: 0, height: 0, flags: 2 },
      ],
    };
    expect(inkSelectionGeometry({ runs: [run] }).runs[0]).toBe(run);
  });
});
