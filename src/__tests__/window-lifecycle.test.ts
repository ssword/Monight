import { describe, expect, it, vi } from 'vitest';
import { registerReadingSessionCloseGuard } from '../app/window-lifecycle';

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;

function fakeWindow() {
  const events: string[] = [];
  let handler: CloseHandler | null = null;
  return {
    events,
    onCloseRequested: vi.fn(async (nextHandler: CloseHandler) => {
      handler = nextHandler;
      return vi.fn();
    }),
    destroy: vi.fn(async () => {
      events.push('destroy');
    }),
    requestClose: async () => {
      await handler?.({
        preventDefault: () => {
          events.push('prevent');
        },
      });
    },
  };
}

describe('Reading Session close lifecycle', () => {
  it('holds the close until the final save completes', async () => {
    const appWindow = fakeWindow();
    let finishSave: (() => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          appWindow.events.push('save:start');
          finishSave = () => {
            appWindow.events.push('save:done');
            resolve();
          };
        }),
    );

    await registerReadingSessionCloseGuard(appWindow, save);
    const closing = appWindow.requestClose();
    await appWindow.requestClose();

    expect(appWindow.destroy).not.toHaveBeenCalled();
    finishSave?.();
    await closing;

    expect(appWindow.events).toEqual(['prevent', 'save:start', 'prevent', 'save:done', 'destroy']);
  });

  it('retries a failed final save before closing', async () => {
    const appWindow = fakeWindow();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('store unavailable'))
      .mockResolvedValueOnce(undefined);
    const choose = vi.fn(async () => 'retry' as const);

    await registerReadingSessionCloseGuard(appWindow, save, choose);
    await appWindow.requestClose();
    await appWindow.requestClose();

    expect(save).toHaveBeenCalledTimes(2);
    expect(choose).toHaveBeenCalledOnce();
    expect(appWindow.destroy).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('only quits with dirty state after an explicit discard choice', async () => {
    const appWindow = fakeWindow();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi.fn(async () => {
      throw new Error('store unavailable');
    });
    const choose = vi.fn(async () => 'discard' as const);

    await registerReadingSessionCloseGuard(appWindow, save, choose);
    await appWindow.requestClose();

    expect(save).toHaveBeenCalledOnce();
    expect(choose).toHaveBeenCalledOnce();
    expect(appWindow.destroy).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('does not flush the main Reading Session when an auxiliary window closes', async () => {
    const mainWindow = fakeWindow();
    const settingsWindow = fakeWindow();
    const save = vi.fn(async () => undefined);

    await registerReadingSessionCloseGuard(mainWindow, save);
    await settingsWindow.requestClose();

    expect(save).not.toHaveBeenCalled();
    expect(mainWindow.destroy).not.toHaveBeenCalled();
  });
});
