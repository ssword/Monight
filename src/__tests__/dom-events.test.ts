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
      activateDocument: vi.fn(async () => undefined),
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
      onPresetApplied: vi.fn(),
      saveCurrentTabState: vi.fn(),
      updateUI: vi.fn(),
      activateDocument,
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
    });

    const secondTab = document.querySelector<HTMLElement>('[data-tab-id="two"]');
    secondTab?.focus();
    secondTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    await vi.waitFor(() => expect(activateDocument).toHaveBeenCalledWith('/one.pdf'));
    expect(document.activeElement?.getAttribute('data-tab-id')).toBe('one');
  });
});
