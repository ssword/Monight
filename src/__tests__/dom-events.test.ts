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
      onPresetApplied: vi.fn(),
      saveCurrentTabState: vi.fn(),
      updateUI: vi.fn(),
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
    });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', metaKey: true, bubbles: true, cancelable: true }),
    );
    await Promise.resolve();

    expect(handleEvent).toHaveBeenCalledOnce();
    expect(windowAddEventListener).not.toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
