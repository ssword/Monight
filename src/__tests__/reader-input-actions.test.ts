import { describe, expect, it, vi } from 'vitest';
import { registerKeybindActions } from '../app/keybinds';
import type { KeybindManager } from '../scripts/keybind-manager';

const readingSession = (activeDocumentPath: string | null = null) => ({
  schemaVersion: 3 as const,
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
  it('runs zoom, page-step, slideshow and full screen keybinds as their native menu commands', async () => {
    const handlers = new Map<string, () => void | Promise<void>>();
    const keybindManager = {
      registerAction: (name: string, handler: () => void | Promise<void>) => {
        handlers.set(name, handler);
      },
    } as unknown as KeybindManager;
    const dispatchReaderAction = vi.fn(async () => undefined);
    const runReaderCommand = vi.fn(async () => true);

    registerKeybindActions({
      keybindManager,
      getReadingSessionSnapshot: () => readingSession(),
      getActivePageCount: async () => 0,
      openPdfAndRefresh: vi.fn(async () => undefined),
      openSettings: vi.fn(async () => undefined),
      updateTabBarVisibility: vi.fn(),
      updateUI: vi.fn(),
      openSearch: vi.fn(),
      goToPage: vi.fn(async () => undefined),
      runReaderCommand,
      dispatchReaderAction,
    });

    for (const action of [
      'zoomIn',
      'zoomOut',
      'resetZoom',
      'fitToPage',
      'fitToWidth',
      'nextPage',
      'previousPage',
      'presentationMode',
      'toggleFullscreen',
    ]) {
      await handlers.get(action)?.();
    }

    expect(runReaderCommand.mock.calls).toEqual([
      ['view.zoom.in'],
      ['view.zoom.out'],
      ['view.zoom.actual-size'],
      ['view.zoom.fit'],
      ['view.zoom.width'],
      ['go.next-page'],
      ['go.previous-page'],
      ['view.slideshow'],
      ['view.full-screen'],
    ]);
    expect(dispatchReaderAction).not.toHaveBeenCalled();
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
      goToPage: vi.fn(async () => undefined),
      runReaderCommand: vi.fn(async () => true),
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
      goToPage: vi.fn(async () => undefined),
      runReaderCommand: vi.fn(async () => true),
      dispatchReaderAction,
    });

    await handlers.get('print')?.();

    expect(dispatchReaderAction).toHaveBeenCalledWith({ type: 'printDocument' });
  });

  it('runs reader-command shortcuts as the native menu command they name', async () => {
    const handlers = new Map<string, (event: unknown, data?: string) => void | Promise<void>>();
    const runReaderCommand = vi.fn(async () => true);
    registerKeybindActions({
      keybindManager: {
        registerAction: (name: string, handler: () => void | Promise<void>) => {
          handlers.set(name, handler);
        },
      } as unknown as KeybindManager,
      getReadingSessionSnapshot: () => readingSession(),
      getActivePageCount: async () => 0,
      openPdfAndRefresh: vi.fn(async () => undefined),
      openSettings: vi.fn(async () => undefined),
      updateTabBarVisibility: vi.fn(),
      updateUI: vi.fn(),
      openSearch: vi.fn(),
      goToPage: vi.fn(async () => undefined),
      runReaderCommand,
      dispatchReaderAction: vi.fn(async () => undefined),
    });

    await handlers.get('readerCommand')?.({}, 'view.sidebar.thumbnails');
    await handlers.get('readerCommand')?.({});

    expect(runReaderCommand.mock.calls).toEqual([['view.sidebar.thumbnails']]);
  });
});
