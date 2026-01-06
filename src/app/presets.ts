import { PRESETS, buildFilterCSS, type FilterSettings } from '../scripts/filters';
import type { SliderManager } from '../scripts/sliders';
import type { TabManager } from '../scripts/tabs';

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
  tabManager: TabManager | null,
  sliderManager: SliderManager | null,
  onPresetApplied?: (settings: FilterSettings) => void,
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
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        return;
      }

      // Get preset settings
      const settings = PRESETS[presetName];
      if (!settings) {
        console.error(`Unknown preset: ${presetName}`);
        return;
      }

      // Build CSS filter string
      const filterCSS = buildFilterCSS(settings);

      // Apply to active tab's PDF viewer
      const activeTab = tabManager?.getActiveTab();
      if (activeTab) {
        const viewer = tabManager?.getViewerForTab(activeTab.id);
        if (viewer) {
          viewer.applyFilter(filterCSS);
          // Save filter to tab state
          activeTab.filterSettings = settings;
        }
      }

      // Update slider positions if initialized
      if (sliderManager?.isInitialized()) {
        sliderManager.setPreset(settings);
      }

      onPresetApplied?.(settings);

      // Update active button state
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      console.log(`Applied preset: ${presetName}`);
    });
  });
}
