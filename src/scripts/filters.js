/**
 * Preset filter configurations
 */
export const PRESETS = {
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
/**
 * Build CSS filter string from filter settings
 *
 * The filter formula applies two brightness transforms:
 * 1. First brightness: reduces brightness based on brightness parameter
 * 2. Second brightness: adjusts brightness based on extraBrightness parameter
 */
export function buildFilterCSS(settings) {
    const parts = [];
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
