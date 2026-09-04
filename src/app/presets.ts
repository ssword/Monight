import { debugLog } from '../lib/debug-log';
import { type FilterSettings, PRESETS } from '../scripts/filters';
import type { SliderManager } from '../scripts/sliders';

// Toggle dark mode configurator panel
export function toggleDarkConfigurator(sliderManager: SliderManager | null): void {
  const panel = document.getElementById('darkConfigurator');
  if (!panel) return;

  const isHidden = panel.classList.contains('hidden');

  if (isHidden) {
    panel.classList.remove('hidden');
    // Initialize sliders on first open
    if (sliderManager && !sliderManager.isInitialized()) {
      sliderManager.initialize();
    }
  } else {
    panel.classList.add('hidden');
  }
}

// Setup preset button handlers
export function setupPresetButtons(
  sliderManager: SliderManager | null,
  onPresetApplied: (settings: FilterSettings) => void,
): void {
  const buttons = document.querySelectorAll('.preset-btn');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Extract preset name from button ID (e.g., 'preset-default' -> 'default')
      const presetName = btn.id.replace('preset-', '');

      // Handle custom button - toggle panel
      if (presetName === 'custom') {
        toggleDarkConfigurator(sliderManager);
        // Update active button state
        buttons.forEach((b) => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        return;
      }

      // Get preset settings
      const settings = PRESETS[presetName];
      if (!settings) {
        console.error(`Unknown preset: ${presetName}`);
        return;
      }

      // Update slider positions if initialized
      if (sliderManager?.isInitialized()) {
        sliderManager.setPreset(settings);
      }

      onPresetApplied(settings);

      // Update active button state
      buttons.forEach((b) => {
        b.classList.remove('active');
      });
      btn.classList.add('active');

      debugLog(`Applied preset: ${presetName}`);
    });
  });
}
