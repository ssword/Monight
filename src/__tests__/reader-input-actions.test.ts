import { describe, expect, it, vi } from 'vitest';
import { registerKeybindActions } from '../app/keybinds';
import type { KeybindManager } from '../scripts/keybind-manager';

const readingSession = (activeDocumentPath: string | null = null) => ({
  schemaVersion: 2 as const,
  revision: 0,
  activeDocumentPath,
  documents: activeDocumentPath
    ? [
        {
          filePath: activeDocumentPath,
          title: 'first.pdf',
          readingPosition: { page: 1, location: 0 },
        },
      ]
    : [],
});

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
      getReadingSessionSnapshot: () => readingSession(),
      getActivePageCount: async () => 0,
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
      getReadingSessionSnapshot: () => readingSession('/docs/first.pdf'),
      getActivePageCount: async () => 1,
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
      getReadingSessionSnapshot: () => readingSession(),
      getActivePageCount: async () => 0,
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
