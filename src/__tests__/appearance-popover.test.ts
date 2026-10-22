// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupEventListeners } from '../app/dom-events';
import type { KeybindManager } from '../scripts/keybind-manager';
import type { SliderManager } from '../scripts/sliders';

const loadAppShell = () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  document.body.innerHTML = html
    .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '');
};

const SEPIA = { brightness: 0, grayscale: 0, invert: 25, sepia: 100, hue: 0, extraBrightness: -30 };
const ORIGINAL = { brightness: 0, grayscale: 0, invert: 0, sepia: 0, hue: 0, extraBrightness: 0 };
const TUNED = { brightness: 20, grayscale: 40, invert: 90, sepia: 10, hue: 90, extraBrightness: 5 };

const fakeSliders = () => {
  let initialized = false;
  return {
    isInitialized: vi.fn(() => initialized),
    initialize: vi.fn(() => {
      initialized = true;
    }),
    setPreset: vi.fn(),
  };
};

const setup = (keybindManager: KeybindManager | null = null) => {
  const dispatchReaderAction = vi.fn(async (_action: unknown) => undefined);
  const sliders = fakeSliders();
  const controls = setupEventListeners({
    sliderManager: sliders as unknown as SliderManager,
    keybindManager,
    openPdfAndRefresh: vi.fn(async () => undefined),
    activateDocument: vi.fn(async () => undefined),
    openRecentFile: vi.fn(async () => undefined),
    clearRecentFiles: vi.fn(async () => undefined),
    dispatchReaderAction,
  });
  return { controls, dispatchReaderAction, sliders };
};

const el = (id: string) => document.getElementById(id) as HTMLElement;
const presetButtons = () =>
  Array.from(el('appearance-popover').querySelectorAll<HTMLButtonElement>('.preset-btn'));
const checkedPreset = () =>
  presetButtons()
    .filter((button) => button.getAttribute('aria-checked') === 'true')
    .map((button) => button.textContent);
const popoverOpen = () => !el('appearance-popover').classList.contains('hidden');
const slidersShown = () => !el('appearance-sliders').classList.contains('hidden');

describe('Appearance popover', () => {
  beforeEach(loadAppShell);

  it('opens from the toolbar Appearance button with the presets in order', () => {
    setup();
    expect(popoverOpen()).toBe(false);

    el('appearance-toggle').click();

    expect(popoverOpen()).toBe(true);
    expect(el('appearance-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(presetButtons().map((button) => button.textContent)).toEqual([
      'Default',
      'Original',
      'Redeye',
      'Sepia',
      'Custom',
    ]);
  });

  it('applies a chosen preset to the active Document through the filter Reader Action', async () => {
    const { dispatchReaderAction } = setup();
    el('appearance-toggle').click();

    el('preset-sepia').click();

    await vi.waitFor(() => expect(dispatchReaderAction).toHaveBeenCalledOnce());
    // No filePath: the action targets the active Document only.
    expect(dispatchReaderAction).toHaveBeenCalledWith({
      type: 'setFilterSettings',
      filterSettings: SEPIA,
    });
    expect(checkedPreset()).toEqual(['Sepia']);
  });

  it('reveals the filter sliders inline when Custom is chosen', () => {
    const { dispatchReaderAction, sliders } = setup();
    el('appearance-toggle').click();
    expect(slidersShown()).toBe(false);

    el('preset-custom').click();

    expect(slidersShown()).toBe(true);
    expect(el('appearance-popover').contains(el('appearance-sliders'))).toBe(true);
    expect(sliders.initialize).toHaveBeenCalledOnce();
    expect(checkedPreset()).toEqual(['Custom']);
    expect(dispatchReaderAction).not.toHaveBeenCalled();

    el('preset-original').click();
    expect(slidersShown()).toBe(false);
  });

  it('offers its presets to other input adapters such as the View menu', async () => {
    const { controls, dispatchReaderAction } = setup();

    controls.chooseAppearance('sepia');
    await vi.waitFor(() =>
      expect(dispatchReaderAction).toHaveBeenCalledWith({
        type: 'setFilterSettings',
        filterSettings: SEPIA,
      }),
    );
    expect(checkedPreset()).toEqual(['Sepia']);

    // Custom opens the popover on its sliders, as the Custom button does.
    controls.chooseAppearance('custom');
    expect(popoverOpen()).toBe(true);
    expect(slidersShown()).toBe(true);
    expect(checkedPreset()).toEqual(['Custom']);
    expect(dispatchReaderAction).toHaveBeenCalledOnce();
  });

  it("shows each Document's current preset when switching Documents", () => {
    const { controls, sliders } = setup();

    controls.showAppearance('/docs/report.pdf', SEPIA);
    expect(checkedPreset()).toEqual(['Sepia']);

    controls.showAppearance('/docs/thesis.pdf', TUNED);
    expect(checkedPreset()).toEqual(['Custom']);
    expect(slidersShown()).toBe(true);
    expect(sliders.setPreset).toHaveBeenLastCalledWith(TUNED);

    controls.showAppearance('/docs/report.pdf', SEPIA);
    expect(checkedPreset()).toEqual(['Sepia']);
    expect(slidersShown()).toBe(false);
  });

  it('keeps Custom open while the active Document still matches a preset', () => {
    const { controls } = setup();
    controls.showAppearance('/docs/report.pdf', ORIGINAL);
    el('appearance-toggle').click();
    el('preset-custom').click();

    // A later snapshot of the same Document (e.g. a settled scroll) keeps Custom.
    controls.showAppearance('/docs/report.pdf', ORIGINAL);
    expect(checkedPreset()).toEqual(['Custom']);
    expect(slidersShown()).toBe(true);

    controls.showAppearance('/docs/thesis.pdf', ORIGINAL);
    expect(checkedPreset()).toEqual(['Original']);
    expect(slidersShown()).toBe(false);
  });

  it('closes on an outside click and on Escape, returning focus to the button', () => {
    setup();
    el('appearance-toggle').click();
    el('preset-custom').click();
    el('appearance-sliders').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(popoverOpen()).toBe(true);

    el('pdf-container').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(popoverOpen()).toBe(false);

    el('appearance-toggle').click();
    el('preset-sepia').focus();
    el('preset-sepia').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(popoverOpen()).toBe(false);
    expect(el('appearance-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(el('appearance-toggle'));
  });

  it('leaves arrow keys inside the popover to its controls instead of page shortcuts', async () => {
    const handleEvent = vi.fn(async () => undefined);
    setup({
      matchEvent: vi.fn(() => 'nextPage'),
      handleEvent,
    } as unknown as KeybindManager);
    el('appearance-toggle').click();
    el('preset-custom').click();

    const handle = document.createElement('div');
    handle.setAttribute('role', 'slider');
    handle.tabIndex = 0;
    el('brightnessSlider').append(handle);
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(handleEvent).not.toHaveBeenCalled();

    el('pdf-container').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(handleEvent).toHaveBeenCalledOnce();
  });

  it('keeps the popover in the chrome, outside the filtered page content', () => {
    expect(el('toolbar').contains(el('appearance-popover'))).toBe(true);
    expect(el('document-workspace').contains(el('appearance-popover'))).toBe(false);
    // The old full-window configurator overlay is gone.
    expect(document.querySelector('.dark-configurator')).toBeNull();
    expect(document.getElementById('preset-menu')).toBeNull();
  });
});
