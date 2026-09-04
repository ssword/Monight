import { describe, expect, it, vi } from 'vitest';
import { registerKeybindActions } from '../app/keybinds';
import type { KeybindManager } from '../scripts/keybind-manager';

describe('reader visual input adapters', () => {
  it('dispatches keybind zoom as the same typed Reader Action', async () => {
    const handlers = new Map<string, () => void | Promise<void>>();
    const keybindManager = {
      registerAction: (name: string, handler: () => void | Promise<void>) => {
        handlers.set(name, handler);
      },
    } as unknown as KeybindManager;
    const dispatchReaderAction = vi.fn(async () => undefined);

    registerKeybindActions({
      keybindManager,
      tabManager: null,
      openPdfAndRefresh: vi.fn(async () => undefined),
      openSettings: vi.fn(async () => undefined),
      updateTabBarVisibility: vi.fn(),
      updateUI: vi.fn(),
      openSearch: vi.fn(),
      togglePresentationMode: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
      goToRelativePage: vi.fn(async () => undefined),
      dispatchReaderAction,
    });

    await handlers.get('zoomIn')?.();

    expect(dispatchReaderAction).toHaveBeenCalledWith({ type: 'zoomIn' });
  });

  it('dispatches close and reopen keybinds as typed Reader Actions', async () => {
    const handlers = new Map<string, () => void | Promise<void>>();
    const keybindManager = {
      registerAction: (name: string, handler: () => void | Promise<void>) => {
        handlers.set(name, handler);
      },
    } as unknown as KeybindManager;
    const dispatchReaderAction = vi.fn(async () => undefined);

    registerKeybindActions({
      keybindManager,
      tabManager: {
        getActiveTab: () => ({ id: 'first', filePath: '/docs/first.pdf' }),
      } as never,
      openPdfAndRefresh: vi.fn(async () => undefined),
      openSettings: vi.fn(async () => undefined),
      updateTabBarVisibility: vi.fn(),
      updateUI: vi.fn(),
      openSearch: vi.fn(),
      togglePresentationMode: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
      goToRelativePage: vi.fn(async () => undefined),
      dispatchReaderAction,
    });

    await handlers.get('closeTab')?.();
    await handlers.get('reopenTab')?.();

    expect(dispatchReaderAction.mock.calls).toEqual([
      [{ type: 'closeDocument', filePath: '/docs/first.pdf' }],
      [{ type: 'reopenLastClosedDocument' }],
    ]);
  });

  it('dispatches print keybinds as a semantic Reader Action', async () => {
    const handlers = new Map<string, () => void | Promise<void>>();
    const keybindManager = {
      registerAction: (name: string, handler: () => void | Promise<void>) => {
        handlers.set(name, handler);
      },
    } as unknown as KeybindManager;
    const dispatchReaderAction = vi.fn(async () => undefined);

    registerKeybindActions({
      keybindManager,
      tabManager: null,
      openPdfAndRefresh: vi.fn(async () => undefined),
      openSettings: vi.fn(async () => undefined),
      updateTabBarVisibility: vi.fn(),
      updateUI: vi.fn(),
      openSearch: vi.fn(),
      togglePresentationMode: vi.fn(async () => undefined),
      goToPage: vi.fn(async () => undefined),
      goToRelativePage: vi.fn(async () => undefined),
      dispatchReaderAction,
    });

    await handlers.get('print')?.();

    expect(dispatchReaderAction).toHaveBeenCalledWith({ type: 'printDocument' });
  });
});
