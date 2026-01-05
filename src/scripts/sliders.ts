import noUiSlider, { type API } from 'nouislider';
import type { FilterSettings } from './filters';
import { PRESETS } from './filters';

/**
 * Manages the dark mode customization sliders
 */
export class SliderManager {
  private sliders: Map<keyof FilterSettings, API> = new Map();
  private onUpdate: (settings: FilterSettings) => void;
  private initialized = false;
  private updateTimeout: number | null = null;

  constructor(onUpdate: (settings: FilterSettings) => void) {
    this.onUpdate = onUpdate;
  }

  /**
   * Initialize all sliders
   */
  initialize(): void {
    if (this.initialized) return;

    // Create each slider with appropriate ranges
    this.createSlider('brightness', PRESETS.default.brightness, 0, 100, 1);
    this.createSlider('grayscale', PRESETS.default.grayscale, 0, 100, 1);
    this.createSlider('invert', PRESETS.default.invert, 0, 100, 1);
    this.createSlider('sepia', PRESETS.default.sepia, 0, 100, 1);
    this.createSlider('hue', PRESETS.default.hue, 0, 360, 1);
    this.createSlider('extraBrightness', PRESETS.default.extraBrightness, -100, 200, 1);

    this.initialized = true;
    console.log('SliderManager initialized');
  }

  /**
   * Create a single slider
   */
  private createSlider(
    name: keyof FilterSettings,
    start: number,
    min: number,
    max: number,
    step: number,
  ): void {
    const elementId = `${name}Slider`;
    const element = document.getElementById(elementId);

    if (!element) {
      console.error(`Slider element not found: ${elementId}`);
      return;
    }

    // Create slider
    const slider = noUiSlider.create(element, {
      start,
      step,
      connect: 'lower',
      range: { min, max },
      tooltips: {
        to: (value: number) => {
          // Format tooltip based on slider type
          if (name === 'hue') {
            return `${Math.round(value)}°`;
          }
          return `${Math.round(value)}%`;
        },
        from: (value: string) => Number(value.replace(/[°%]/g, '')),
      },
    });

    // Store slider instance
    this.sliders.set(name, slider);

    // Add update listener with debouncing
    slider.on('update', () => this.handleUpdate());

    console.log(`Created slider: ${name} (${min}-${max}, start: ${start})`);
  }

  /**
   * Handle slider updates with debouncing for smooth performance
   */
  private handleUpdate(): void {
    // Clear existing timeout
    if (this.updateTimeout !== null) {
      clearTimeout(this.updateTimeout);
    }

    // Debounce updates to ~60fps (16ms)
    this.updateTimeout = window.setTimeout(() => {
      const settings = this.getCurrentSettings();
      this.onUpdate(settings);
      this.updateTimeout = null;
    }, 16);
  }

  /**
   * Get current filter settings from all sliders
   */
  getCurrentSettings(): FilterSettings {
    return {
      brightness: this.getValue('brightness'),
      grayscale: this.getValue('grayscale'),
      invert: this.getValue('invert'),
      sepia: this.getValue('sepia'),
      hue: this.getValue('hue'),
      extraBrightness: this.getValue('extraBrightness'),
    };
  }

  /**
   * Get value from a specific slider
   */
  private getValue(name: keyof FilterSettings): number {
    const slider = this.sliders.get(name);
    if (!slider) return 0;

    const value = slider.get();
    return typeof value === 'string' ? Number(value) : Number(value[0]);
  }

  /**
   * Update all sliders to match a preset
   */
  setPreset(settings: FilterSettings): void {
    if (!this.initialized) return;

    // Update each slider without triggering updates
    this.sliders.get('brightness')?.set(settings.brightness);
    this.sliders.get('grayscale')?.set(settings.grayscale);
    this.sliders.get('invert')?.set(settings.invert);
    this.sliders.get('sepia')?.set(settings.sepia);
    this.sliders.get('hue')?.set(settings.hue);
    this.sliders.get('extraBrightness')?.set(settings.extraBrightness);

    console.log('Updated sliders to preset:', settings);
  }

  /**
   * Check if sliders are initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Destroy all sliders and cleanup
   */
  destroy(): void {
    if (this.updateTimeout !== null) {
      clearTimeout(this.updateTimeout);
    }

    this.sliders.forEach((slider, name) => {
      try {
        slider.destroy();
        console.log(`Destroyed slider: ${name}`);
      } catch (error) {
        console.error(`Error destroying slider ${name}:`, error);
      }
    });

    this.sliders.clear();
    this.initialized = false;
  }
}
