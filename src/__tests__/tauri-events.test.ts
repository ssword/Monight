import type { DragDropEvent } from '@tauri-apps/api/webview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../scripts/filters';
import type { TabManager } from '../scripts/tabs';

const mocks = vi.hoisted(() => {
  let dragDropHandler: ((event: { payload: DragDropEvent }) => void | Promise<void>) | undefined;

  return {
    invoke: vi.fn(async () => null),
    listen: vi.fn(async () => vi.fn()),
    openFiles: vi.fn(async () => 1),
    onDragDropEvent: vi.fn(
      async (handler: (event: { payload: DragDropEvent }) => void | Promise<void>) => {
        dragDropHandler = handler;
        return vi.fn();
      },
    ),
    getDragDropHandler: () => dragDropHandler,
    resetDragDropHandler: () => {
      dragDropHandler = undefined;
    },
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

import { setupTauriListeners } from '../app/tauri-events';

describe('Tauri drag and drop events', () => {
  const addClass = vi.fn();
  const removeClass = vi.fn();
  const showAlert = vi.fn();

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
    vi.stubGlobal('alert', showAlert);
  });

  it('uses the Tauri 2 drag/drop API and reads paths from the v2 payload', async () => {
    const tabManager = {} as TabManager;

    await setupTauriListeners({
      tabManager,
      settingsManager: null,
      keybindManager: null,
      isMac: true,
      openPdfAndRefresh: vi.fn(async () => undefined),
      getInitialFilterSettings: () => ({ ...PRESETS.default }),
      getInitialViewMode: () => 'single',
      reloadSettings: vi.fn(async () => undefined),
      applyWindowAfterOpen: vi.fn(async () => undefined),
      updateTabBarVisibility: vi.fn(),
      updatePrintMenuState: vi.fn(async () => undefined),
      updateUI: vi.fn(),
      saveCurrentTabState: vi.fn(),
      printCurrentPDF: vi.fn(async () => undefined),
    });

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
});
