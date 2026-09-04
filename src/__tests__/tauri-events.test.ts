import type { DragDropEvent } from '@tauri-apps/api/webview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentIntakeResult } from '../reader/document-intake';
import { PRESETS } from '../scripts/filters';
import type { SettingsManager } from '../scripts/settings';
import type { TabManager } from '../scripts/tabs';

const mocks = vi.hoisted(() => {
  let dragDropHandler: ((event: { payload: DragDropEvent }) => void | Promise<void>) | undefined;
  const listeners = new Map<string, (event?: { payload: unknown }) => void | Promise<void>>();

  return {
    invoke: vi.fn<(command: string) => Promise<unknown>>(async () => []),
    listen: vi.fn(
      async (event: string, handler: (event?: { payload: unknown }) => void | Promise<void>) => {
        listeners.set(event, handler);
        return vi.fn();
      },
    ),
    intakeFiles: vi.fn<(paths: string[], options: unknown) => Promise<DocumentIntakeResult>>(
      async (paths: string[]) => ({
        outcomes: paths.map((path) => ({
          status: 'opened' as const,
          requestedPath: path,
          filePath: path,
        })),
        opened: paths.length,
        activated: 0,
        failed: 0,
      }),
    ),
    reportDocumentIntakeOutcomes: vi.fn(),
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
vi.mock('../app/file-actions', () => ({
  intakeFiles: mocks.intakeFiles,
  reportDocumentIntakeOutcomes: mocks.reportDocumentIntakeOutcomes,
}));
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
    handleStartupExternalOpenPayloads: vi.fn(async () => undefined),
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
    expect(mocks.intakeFiles).toHaveBeenCalledWith(
      ['/tmp/report.pdf', '/tmp/form.xfdf'],
      expect.objectContaining({ tabManager }),
    );
  });

  it('translates drag/drop intake outcomes into non-blocking feedback', async () => {
    const updateTabBarVisibility = vi.fn();
    const updatePrintMenuState = vi.fn(async () => undefined);
    const applyWindowAfterOpen = vi.fn(async () => undefined);
    await setupTauriListeners(
      context({ updateTabBarVisibility, updatePrintMenuState, applyWindowAfterOpen }),
    );
    const handler = mocks.getDragDropHandler();

    const failedResult = {
      outcomes: [
        {
          status: 'failed' as const,
          requestedPath: '/tmp/report.pdf',
          error: new Error('bad PDF'),
        },
      ],
      opened: 0,
      activated: 0,
      failed: 1,
    };
    mocks.intakeFiles.mockResolvedValueOnce(failedResult);
    await handler?.({
      payload: {
        type: 'drop',
        paths: ['/tmp/report.pdf'],
        position: { x: 1, y: 2 } as never,
      },
    });

    expect(mocks.reportDocumentIntakeOutcomes).toHaveBeenCalledWith(
      failedResult,
      expect.any(Function),
    );
    expect(updateTabBarVisibility).not.toHaveBeenCalled();
    expect(updatePrintMenuState).not.toHaveBeenCalled();
    expect(applyWindowAfterOpen).not.toHaveBeenCalled();
  });

  it('passes the startup CLI request to the startup restoration workflow', async () => {
    mocks.invoke.mockImplementationOnce(async () => [
      { files: ['/tmp/report.pdf'], page: 7, source: 'commandLine' },
    ]);
    const handleStartupExternalOpenPayloads = vi.fn(async () => undefined);

    await setupTauriListeners(context({ handleStartupExternalOpenPayloads }));

    expect(handleStartupExternalOpenPayloads).toHaveBeenCalledWith([
      { files: ['/tmp/report.pdf'], page: 7, source: 'commandLine' },
    ]);
    expect(mocks.intakeFiles).not.toHaveBeenCalled();
  });

  it('holds live external requests until startup restoration completes', async () => {
    let finishStartup: (() => void) | undefined;
    const handleStartupExternalOpenPayloads = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          finishStartup = resolve;
        }),
    );
    mocks.invoke
      .mockResolvedValueOnce([{ files: ['/tmp/startup.pdf'], page: null, source: 'commandLine' }])
      .mockResolvedValueOnce([{ files: ['/tmp/live.pdf'], page: null, source: 'operatingSystem' }])
      .mockResolvedValueOnce([]);

    const setup = setupTauriListeners(context({ handleStartupExternalOpenPayloads }));
    await vi.waitFor(() => expect(handleStartupExternalOpenPayloads).toHaveBeenCalledOnce());
    const liveRequest = mocks.getListener('external-open-files-available')?.();
    await Promise.resolve();
    expect(mocks.intakeFiles).not.toHaveBeenCalled();

    finishStartup?.();
    await setup;
    await liveRequest;

    expect(mocks.intakeFiles).toHaveBeenCalledWith(
      ['/tmp/live.pdf'],
      expect.objectContaining({ tabManager: expect.anything() }),
    );
  });

  it('routes operating-system open and file-association payloads through Document Intake', async () => {
    await setupTauriListeners(context());
    mocks.invoke.mockResolvedValueOnce([
      {
        files: ['/tmp/associated.pdf', '/tmp/missing.pdf'],
        page: null,
        source: 'operatingSystem',
      },
    ]);

    await mocks.getListener('external-open-files-available')?.();

    expect(mocks.intakeFiles).toHaveBeenCalledWith(
      ['/tmp/associated.pdf', '/tmp/missing.pdf'],
      expect.objectContaining({ tabManager: expect.anything() }),
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
