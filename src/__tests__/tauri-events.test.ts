import type { DragDropEvent } from '@tauri-apps/api/webview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../scripts/filters';
import type { SettingsManager } from '../scripts/settings';
import type { TabManager } from '../scripts/tabs';

const mocks = vi.hoisted(() => {
  let dragDropHandler: ((event: { payload: DragDropEvent }) => void | Promise<void>) | undefined;
  const listeners = new Map<string, () => void | Promise<void>>();

  return {
    invoke: vi.fn<(command: string) => Promise<{ files: string[]; page: number | null } | null>>(
      async () => null,
    ),
    listen: vi.fn(async (event: string, handler: () => void | Promise<void>) => {
      listeners.set(event, handler);
      return vi.fn();
    }),
    openFiles: vi.fn(
      async (_paths: string[], _options: { onError?: (message: string) => void }) => 1,
    ),
    showToast: vi.fn(),
    onDragDropEvent: vi.fn(
      async (handler: (event: { payload: DragDropEvent }) => void | Promise<void>) => {
        dragDropHandler = handler;
        return vi.fn();
      },
    ),
    getDragDropHandler: () => dragDropHandler,
    resetDragDropHandler: () => {
      dragDropHandler = undefined;
      listeners.clear();
    },
    getListener: (event: string) => listeners.get(event),
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: mocks.onDragDropEvent }),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    isFullscreen: vi.fn(async () => false),
    setFullscreen: vi.fn(async () => undefined),
  }),
}));
vi.mock('../app/file-actions', () => ({ openFiles: mocks.openFiles }));
vi.mock('../app/dialogs', () => ({ showToast: mocks.showToast }));

import { setupTauriListeners } from '../app/tauri-events';

describe('Tauri drag and drop events', () => {
  const addClass = vi.fn();
  const removeClass = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetDragDropHandler();
    vi.stubGlobal('document', {
      body: {
        classList: {
          add: addClass,
          remove: removeClass,
        },
      },
    });
  });

  const context = (overrides: Record<string, unknown> = {}) => ({
    tabManager: {} as TabManager,
    settingsManager: null,
    keybindManager: null,
    isMac: true,
    openPdfAndRefresh: vi.fn(async () => undefined),
    getInitialFilterSettings: () => ({ ...PRESETS.default }),
    getInitialViewMode: () => 'single' as const,
    reloadSettings: vi.fn(async () => undefined),
    readingHistoryCleared: vi.fn(),
    applyWindowAfterOpen: vi.fn(async () => undefined),
    updateTabBarVisibility: vi.fn(),
    updatePrintMenuState: vi.fn(async () => undefined),
    printCurrentPDF: vi.fn(async () => undefined),
    dispatchReaderAction: vi.fn(async () => undefined),
    ...overrides,
  });

  it('uses the Tauri 2 drag/drop API and reads paths from the v2 payload', async () => {
    const tabManager = {} as TabManager;

    await setupTauriListeners(context({ tabManager }));

    expect(mocks.onDragDropEvent).toHaveBeenCalledOnce();
    expect(mocks.listen).not.toHaveBeenCalledWith('tauri://file-drop', expect.any(Function));

    const handler = mocks.getDragDropHandler();
    expect(handler).toBeDefined();

    await handler?.({
      payload: {
        type: 'enter',
        paths: ['/tmp/report.pdf'],
        position: { x: 1, y: 2 } as never,
      },
    });
    expect(addClass).toHaveBeenCalledWith('drag-over');

    await handler?.({
      payload: {
        type: 'drop',
        paths: ['/tmp/report.pdf', '/tmp/form.xfdf'],
        position: { x: 1, y: 2 } as never,
      },
    });

    expect(removeClass).toHaveBeenCalledWith('drag-over');
    expect(mocks.openFiles).toHaveBeenCalledWith(
      ['/tmp/report.pdf'],
      expect.objectContaining({ tabManager, continueOnError: true }),
    );
  });

  it('reports drag/drop errors through non-blocking toasts', async () => {
    await setupTauriListeners(context());
    const handler = mocks.getDragDropHandler();

    await handler?.({
      payload: {
        type: 'drop',
        paths: ['/tmp/form.xfdf'],
        position: { x: 1, y: 2 } as never,
      },
    });

    expect(mocks.showToast).toHaveBeenCalledWith('Please drop PDF files only.', 'error');

    mocks.openFiles.mockImplementationOnce(async (_paths, options) => {
      options.onError?.('Could not read /tmp/report.pdf');
      return 0;
    });
    await handler?.({
      payload: {
        type: 'drop',
        paths: ['/tmp/report.pdf'],
        position: { x: 1, y: 2 } as never,
      },
    });

    expect(mocks.showToast).toHaveBeenCalledWith('Could not read /tmp/report.pdf', 'error');
  });

  it('reports startup CLI page intent before Reading Session restoration', async () => {
    const reportStartupIntent = vi.fn();
    mocks.invoke.mockImplementationOnce(async () => ({ files: ['/tmp/report.pdf'], page: 7 }));

    await setupTauriListeners(context({ reportStartupIntent }));

    expect(reportStartupIntent).toHaveBeenCalledWith({ files: ['/tmp/report.pdf'], page: 7 });
    expect(mocks.openFiles).toHaveBeenCalledWith(
      ['/tmp/report.pdf'],
      expect.objectContaining({ page: 7 }),
    );
  });

  it('handles the Settings clear-history request in the main window', async () => {
    const clearReadingHistory = vi.fn(async () => undefined);
    const readingHistoryCleared = vi.fn();
    await setupTauriListeners(
      context({
        settingsManager: { clearReadingHistory } as unknown as SettingsManager,
        readingHistoryCleared,
      }),
    );

    await mocks.getListener('clear-reading-history')?.();

    expect(clearReadingHistory).toHaveBeenCalledOnce();
    expect(readingHistoryCleared).toHaveBeenCalledOnce();
  });

  it('dispatches native menu zoom as the same typed Reader Action', async () => {
    const dispatchReaderAction = vi.fn(async () => undefined);
    await setupTauriListeners(context({ dispatchReaderAction }));

    await mocks.getListener('menu-zoom-in')?.();

    expect(dispatchReaderAction).toHaveBeenCalledWith({ type: 'zoomIn' });
  });
});
