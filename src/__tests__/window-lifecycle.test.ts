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

  it('closes after a failed save and ignores re-entrant close requests', async () => {
    const appWindow = fakeWindow();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi.fn(async () => {
      throw new Error('store unavailable');
    });

    await registerReadingSessionCloseGuard(appWindow, save);
    await appWindow.requestClose();
    await appWindow.requestClose();

    expect(save).toHaveBeenCalledOnce();
    expect(appWindow.destroy).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
