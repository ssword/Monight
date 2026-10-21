import { describe, expect, it } from 'vitest';
import { APPEARANCE_PRESETS, presetForFilterSettings } from '../scripts/filters';

describe('appearance presets', () => {
  it('lists the filter presets once, in menu order', () => {
    expect(APPEARANCE_PRESETS.map(({ id, label }) => [id, label])).toEqual([
      ['default', 'Default'],
      ['original', 'Original'],
      ['redeye', 'Redeye'],
      ['sepia', 'Sepia'],
      ['custom', 'Custom'],
    ]);
  });

  it('names the preset a Document is using, or Custom when none match', () => {
    expect(
      presetForFilterSettings({
        brightness: 0,
        grayscale: 0,
        invert: 25,
        sepia: 100,
        hue: 0,
        extraBrightness: -30,
      }),
    ).toBe('sepia');
    expect(
      presetForFilterSettings({
        brightness: 0,
        grayscale: 0,
        invert: 0,
        sepia: 0,
        hue: 0,
        extraBrightness: 0,
      }),
    ).toBe('original');
    expect(
      presetForFilterSettings({
        brightness: 12,
        grayscale: 0,
        invert: 0,
        sepia: 0,
        hue: 0,
        extraBrightness: 0,
      }),
    ).toBe('custom');
  });
});
