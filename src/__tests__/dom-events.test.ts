// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { setupEventListeners } from '../app/dom-events';
import { registerKeybindActions } from '../app/keybinds';
import type { KeybindManager } from '../scripts/keybind-manager';

describe('setupEventListeners', () => {
  it('routes a matched shortcut through the document-level handler exactly once', async () => {
    const windowAddEventListener = vi.spyOn(window, 'addEventListener');
    const handleEvent = vi.fn(async () => undefined);
    const keybindManager = {
      matchEvent: vi.fn((event: KeyboardEvent) => (event.key === 'o' ? 'open' : null)),
      handleEvent,
    } as unknown as KeybindManager;

    setupEventListeners({
      sliderManager: null,
      keybindManager,
      openPdfAndRefresh: vi.fn(async () => undefined),
      activateDocument: vi.fn(async () => undefined),
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      dispatchReaderAction: vi.fn(async () => undefined),
    });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', metaKey: true, bubbles: true, cancelable: true }),
    );
    await Promise.resolve();

    expect(handleEvent).toHaveBeenCalledOnce();
    expect(windowAddEventListener).not.toHaveBeenCalledWith('keydown', expect.any(Function));

    document.body.innerHTML = '<button role="tab">report.pdf</button>';
    const tab = document.querySelector<HTMLButtonElement>('[role="tab"]');
    tab?.focus();
    tab?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', metaKey: true, bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(handleEvent).toHaveBeenCalledTimes(2);
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
      sliderManager: null,
      keybindManager: null,
      openPdfAndRefresh: vi.fn(async () => undefined),
      activateDocument,
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      dispatchReaderAction: vi.fn(async () => undefined),
    });

    const secondTab = document.querySelector<HTMLElement>('[data-tab-id="two"]');
    secondTab?.focus();
    secondTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    await vi.waitFor(() => expect(activateDocument).toHaveBeenCalledWith('/one.pdf'));
    expect(document.activeElement?.getAttribute('data-tab-id')).toBe('one');
  });

  it('dispatches retained toolbar choices as typed Reader Actions', async () => {
    document.body.innerHTML = `
      <button id="print-file"></button>
      <button id="preset-original" class="preset-btn"></button>
    `;
    const dispatchReaderAction = vi.fn(async (_action: unknown) => undefined);

    setupEventListeners({
      sliderManager: null,
      keybindManager: null,
      openPdfAndRefresh: vi.fn(async () => undefined),
      activateDocument: vi.fn(async () => undefined),
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      dispatchReaderAction,
    });

    for (const id of ['print-file', 'preset-original']) {
      document.getElementById(id)?.click();
    }
    await vi.waitFor(() => expect(dispatchReaderAction).toHaveBeenCalledTimes(2));

    expect(dispatchReaderAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'printDocument' },
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

describe('toolbar input adapters', () => {
  const listen = (dispatchReaderAction: (action: unknown) => Promise<void>) =>
    setupEventListeners({
      sliderManager: null,
      keybindManager: null,
      openPdfAndRefresh: vi.fn(async () => undefined),
      activateDocument: vi.fn(async () => undefined),
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      dispatchReaderAction,
    });

  it('dispatches the zoom group as the same Reader Actions as the zoom shortcuts', async () => {
    const handlers = new Map<string, () => void | Promise<void>>();
    const shortcutActions: unknown[] = [];
    registerKeybindActions({
      keybindManager: {
        registerAction: (name: string, handler: () => void | Promise<void>) => {
          handlers.set(name, handler);
        },
      } as unknown as KeybindManager,
      getReadingSessionSnapshot: () => ({
        schemaVersion: 3,
        revision: 0,
        activeDocumentPath: null,
        documents: [],
      }),
      getActivePageCount: async () => 0,
      openPdfAndRefresh: vi.fn(async () => undefined),
      openSettings: vi.fn(async () => undefined),
      updateTabBarVisibility: vi.fn(),
      updateUI: vi.fn(),
      openSearch: vi.fn(),
      togglePresentationMode: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
      goToRelativePage: vi.fn(async () => undefined),
      runReaderCommand: vi.fn(async () => true),
      dispatchReaderAction: async (action) => {
        shortcutActions.push(action);
      },
    });
    for (const name of ['zoomOut', 'fitToPage', 'zoomIn']) await handlers.get(name)?.();

    document.body.innerHTML = `
      <div class="toolbar-capsule">
        <button id="zoom-out"></button>
        <button id="zoom-to-fit"></button>
        <button id="zoom-in"></button>
      </div>
    `;
    const dispatchReaderAction = vi.fn(async (_action: unknown) => undefined);
    listen(dispatchReaderAction);
    for (const id of ['zoom-out', 'zoom-to-fit', 'zoom-in']) document.getElementById(id)?.click();

    await vi.waitFor(() => expect(dispatchReaderAction).toHaveBeenCalledTimes(3));
    expect(dispatchReaderAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'zoomOut' },
      { type: 'setZoomIntent', zoomIntent: { kind: 'fit-page' } },
      { type: 'zoomIn' },
    ]);
    expect(shortcutActions).toEqual(dispatchReaderAction.mock.calls.map(([action]) => action));
  });
});
