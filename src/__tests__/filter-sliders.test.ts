// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterSettings } from '../scripts/filters';
import { SliderManager } from '../scripts/sliders';

const SLIDER_IDS = ['brightness', 'grayscale', 'invert', 'sepia', 'hue', 'extraBrightness'];
const SEPIA = { brightness: 0, grayscale: 0, invert: 25, sepia: 100, hue: 0, extraBrightness: -30 };

const sliderElement = (name: string) =>
  document.getElementById(`${name}Slider`) as HTMLElement & {
    noUiSlider: { set: (value: number) => void };
  };

describe('filter sliders', () => {
  beforeEach(() => {
    document.body.innerHTML = SLIDER_IDS.map((name) => `<div id="${name}Slider"></div>`).join('');
  });

  it("open at the active Document's settings rather than resetting it to Default", async () => {
    const onUpdate = vi.fn((_settings: FilterSettings) => undefined);
    const sliders = new SliderManager(onUpdate);
    sliders.setPreset(SEPIA);

    sliders.initialize();

    expect(sliders.getCurrentSettings()).toEqual(SEPIA);
    await new Promise((resolve) => setTimeout(resolve, 40));
    for (const [settings] of onUpdate.mock.calls) expect(settings).toEqual(SEPIA);
  });

  it('apply a slider change live', async () => {
    const onUpdate = vi.fn((_settings: FilterSettings) => undefined);
    const sliders = new SliderManager(onUpdate);
    sliders.setPreset(SEPIA);
    sliders.initialize();
    await new Promise((resolve) => setTimeout(resolve, 40));
    onUpdate.mockClear();

    sliderElement('invert').noUiSlider.set(60);

    await vi.waitFor(() => expect(onUpdate).toHaveBeenLastCalledWith({ ...SEPIA, invert: 60 }));
  });
});
