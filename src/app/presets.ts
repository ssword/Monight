import { debugLog } from '../lib/debug-log';
import {
  APPEARANCE_PRESETS,
  type AppearancePresetId,
  type FilterSettings,
  PRESETS,
  presetForFilterSettings,
} from '../scripts/filters';
import type { SliderManager } from '../scripts/sliders';

type AppearanceSliders = Pick<SliderManager, 'initialize' | 'isInitialized' | 'setPreset'>;

export interface AppearancePopover {
  /** Reflects the active Document's filter settings in the popover. */
  show(activeDocumentPath: string | null, filterSettings: FilterSettings): void;
  /** Chooses a preset as its button does; Custom opens the popover on the sliders. */
  choose(preset: AppearancePresetId): void;
}

/**
 * The toolbar Appearance popover: an input adapter that offers the filter
 * presets and, for Custom, the filter sliders inline. Choices go out only
 * through `applyFilterSettings` (the active Document's filter Reader Action).
 */
export function setupAppearancePopover(
  sliderManager: AppearanceSliders | null,
  applyFilterSettings: (settings: FilterSettings) => void,
): AppearancePopover {
  const toggle = document.getElementById('appearance-toggle');
  const popover = document.getElementById('appearance-popover');
  const presetList = document.getElementById('appearance-presets');
  const sliders = document.getElementById('appearance-sliders');

  if (presetList && !presetList.querySelector('.preset-btn')) {
    for (const { id, label } of APPEARANCE_PRESETS) {
      const button = document.createElement('button');
      button.id = `preset-${id}`;
      button.className = 'preset-btn';
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      button.dataset.preset = id;
      button.textContent = label;
      presetList.append(button);
    }
  }

  // Transient: Custom chosen for the active Document while its settings still
  // match a named preset. Reset when another Document becomes active.
  let customChosen = false;
  let shownDocumentPath: string | null = null;

  const presetOf = (button: Element): string =>
    (button as HTMLElement).dataset.preset ?? button.id.replace('preset-', '');

  const showActive = (active: AppearancePresetId) => {
    for (const button of document.querySelectorAll('.preset-btn')) {
      const checked = presetOf(button) === active;
      button.classList.toggle('active', checked);
      button.setAttribute('aria-checked', String(checked));
    }
    const showSliders = active === 'custom';
    if (showSliders && sliderManager && !sliderManager.isInitialized()) {
      sliderManager.initialize();
    }
    sliders?.classList.toggle('hidden', !showSliders);
  };

  const isOpen = () => (popover ? !popover.classList.contains('hidden') : false);
  const setOpen = (open: boolean) => {
    popover?.classList.toggle('hidden', !open);
    toggle?.setAttribute('aria-expanded', String(open));
  };

  toggle?.addEventListener('click', () => setOpen(!isOpen()));

  const choose = (preset: string) => {
    if (preset === 'custom') {
      customChosen = true;
      showActive('custom');
      return;
    }
    const settings = PRESETS[preset];
    if (!settings) {
      console.error(`Unknown preset: ${preset}`);
      return;
    }
    customChosen = false;
    showActive(presetForFilterSettings(settings));
    applyFilterSettings({ ...settings });
    debugLog(`Applied preset: ${preset}`);
  };

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.preset-btn') : null;
    if (button) choose(presetOf(button));
  });

  document.addEventListener('pointerdown', (event) => {
    if (!isOpen()) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (popover?.contains(target) || toggle?.contains(target))) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen()) return;
    event.preventDefault();
    setOpen(false);
    toggle?.focus();
  });

  return {
    show(activeDocumentPath, filterSettings) {
      if (activeDocumentPath !== shownDocumentPath) {
        shownDocumentPath = activeDocumentPath;
        customChosen = false;
      }
      sliderManager?.setPreset(filterSettings);
      showActive(customChosen ? 'custom' : presetForFilterSettings(filterSettings));
    },
    choose(preset) {
      choose(preset);
      if (preset === 'custom') setOpen(true);
    },
  };
}

/** True when a keyboard event belongs to a control inside the Appearance popover. */
export function isWithinAppearancePopover(event: Event): boolean {
  return event
    .composedPath()
    .some((target) => target instanceof Element && target.id === 'appearance-popover');
}
