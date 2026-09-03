// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { setupEventListeners } from '../app/dom-events';
import type { KeybindManager } from '../scripts/keybind-manager';

describe('setupEventListeners', () => {
  it('routes a matched shortcut through the document-level handler exactly once', async () => {
    const windowAddEventListener = vi.spyOn(window, 'addEventListener');
    const handleEvent = vi.fn(async () => undefined);
    const keybindManager = {
      matchEvent: vi.fn(() => 'open'),
      handleEvent,
    } as unknown as KeybindManager;

    setupEventListeners({
      tabManager: null,
      sliderManager: null,
      keybindManager,
      openPdfAndRefresh: vi.fn(async () => undefined),
      printCurrentPDF: vi.fn(async () => undefined),
      updateUI: vi.fn(),
      activateDocument: vi.fn(async () => undefined),
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
      goToRelativePage: vi.fn(async () => undefined),
      dispatchReaderAction: vi.fn(async () => undefined),
    });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', metaKey: true, bubbles: true, cancelable: true }),
    );
    await Promise.resolve();

    expect(handleEvent).toHaveBeenCalledOnce();
    expect(windowAddEventListener).not.toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('switches and focuses Documents with arrow keys', async () => {
    document.body.innerHTML = `
      <div id="tab-container" role="tablist">
        <button id="document-tab-one" role="tab" data-tab-id="one" data-file-path="/one.pdf">one.pdf</button>
        <button id="document-tab-two" role="tab" data-tab-id="two" data-file-path="/two.pdf">two.pdf</button>
      </div>
    `;
    const activateDocument = vi.fn(async () => undefined);

    setupEventListeners({
      tabManager: {} as never,
      sliderManager: null,
      keybindManager: null,
      openPdfAndRefresh: vi.fn(async () => undefined),
      printCurrentPDF: vi.fn(async () => undefined),
      updateUI: vi.fn(),
      activateDocument,
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
      goToRelativePage: vi.fn(async () => undefined),
      dispatchReaderAction: vi.fn(async () => undefined),
    });

    const secondTab = document.querySelector<HTMLElement>('[data-tab-id="two"]');
    secondTab?.focus();
    secondTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    await vi.waitFor(() => expect(activateDocument).toHaveBeenCalledWith('/one.pdf'));
    expect(document.activeElement?.getAttribute('data-tab-id')).toBe('one');
  });

  it('dispatches toolbar visual choices as typed Reader Actions', async () => {
    document.body.innerHTML = `
      <button id="zoom-in"></button>
      <button id="zoom-out"></button>
      <button id="fit-width"></button>
      <button id="fit-page"></button>
      <button id="toggle-view-mode"></button>
      <button id="preset-original" class="preset-btn"></button>
    `;
    const dispatchReaderAction = vi.fn(async (_action: unknown) => undefined);

    setupEventListeners({
      tabManager: null,
      sliderManager: null,
      keybindManager: null,
      openPdfAndRefresh: vi.fn(async () => undefined),
      printCurrentPDF: vi.fn(async () => undefined),
      updateUI: vi.fn(),
      activateDocument: vi.fn(async () => undefined),
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
      goToRelativePage: vi.fn(async () => undefined),
      dispatchReaderAction,
    });

    for (const id of [
      'zoom-in',
      'zoom-out',
      'fit-width',
      'fit-page',
      'toggle-view-mode',
      'preset-original',
    ]) {
      document.getElementById(id)?.click();
    }
    await vi.waitFor(() => expect(dispatchReaderAction).toHaveBeenCalledTimes(6));

    expect(dispatchReaderAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'zoomIn' },
      { type: 'zoomOut' },
      { type: 'setZoomIntent', zoomIntent: { kind: 'fit-width' } },
      { type: 'setZoomIntent', zoomIntent: { kind: 'fit-page' } },
      { type: 'cycleViewMode' },
      {
        type: 'setFilterSettings',
        filterSettings: {
          brightness: 0,
          grayscale: 0,
          invert: 0,
          sepia: 0,
          hue: 0,
          extraBrightness: 0,
        },
      },
    ]);
  });
});
