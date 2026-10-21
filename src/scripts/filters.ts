/**
 * Filter settings for PDF dark mode
 */
export interface FilterSettings {
  brightness: number; // 0-100
  grayscale: number; // 0-100
  invert: number; // 0-100
  sepia: number; // 0-100
  hue: number; // 0-360
  extraBrightness: number; // -100 to 200
}

/**
 * Preset filter configurations
 */
export const PRESETS: Record<string, FilterSettings> = {
  default: {
    brightness: 7,
    grayscale: 95,
    invert: 95,
    sepia: 55,
    hue: 180,
    extraBrightness: 0,
  },
  original: {
    brightness: 0,
    grayscale: 0,
    invert: 0,
    sepia: 0,
    hue: 0,
    extraBrightness: 0,
  },
  redeye: {
    brightness: 8,
    grayscale: 100,
    invert: 92,
    sepia: 100,
    hue: 295,
    extraBrightness: -6,
  },
  sepia: {
    brightness: 0,
    grayscale: 0,
    invert: 25,
    sepia: 100,
    hue: 0,
    extraBrightness: -30,
  },
};

export type AppearancePresetId = 'default' | 'original' | 'redeye' | 'sepia' | 'custom';

/**
 * The single ordered list of Appearance choices shown by every input adapter
 * (the Appearance popover, and the View menu). Custom has no fixed settings:
 * it opens the filter sliders instead.
 */
export const APPEARANCE_PRESETS: readonly { id: AppearancePresetId; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'original', label: 'Original' },
  { id: 'redeye', label: 'Redeye' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'custom', label: 'Custom' },
];

const sameFilterSettings = (a: FilterSettings, b: FilterSettings): boolean =>
  a.brightness === b.brightness &&
  a.grayscale === b.grayscale &&
  a.invert === b.invert &&
  a.sepia === b.sepia &&
  a.hue === b.hue &&
  a.extraBrightness === b.extraBrightness;

/** The preset a Document's filter settings correspond to, or Custom when none match. */
export function presetForFilterSettings(settings: FilterSettings): AppearancePresetId {
  for (const { id } of APPEARANCE_PRESETS) {
    const preset = PRESETS[id];
    if (preset && sameFilterSettings(preset, settings)) return id;
  }
  return 'custom';
}

/**
 * Build CSS filter string from filter settings
 *
 * The filter formula applies two brightness transforms:
 * 1. First brightness: reduces brightness based on brightness parameter
 * 2. Second brightness: adjusts brightness based on extraBrightness parameter
 */
export function buildFilterCSS(settings: FilterSettings): string {
  const parts: string[] = [];

  // First brightness adjustment
  const firstBrightness = (100 - settings.brightness) / 100;
  parts.push(`brightness(${firstBrightness})`);

  // Grayscale
  if (settings.grayscale > 0) {
    parts.push(`grayscale(${settings.grayscale / 100})`);
  }

  // Invert
  if (settings.invert > 0) {
    parts.push(`invert(${settings.invert / 100})`);
  }

  // Sepia
  if (settings.sepia > 0) {
    parts.push(`sepia(${settings.sepia / 100})`);
  }

  // Hue rotation
  if (settings.hue !== 0) {
    parts.push(`hue-rotate(${settings.hue}deg)`);
  }

  // Extra brightness adjustment
  const secondBrightness = (settings.extraBrightness + 100) / 100;
  parts.push(`brightness(${secondBrightness})`);

  return parts.join(' ');
}
