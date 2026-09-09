import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationShutdownCoordinator,
  registerApplicationShutdownHandlers,
} from '../app/window-lifecycle';

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;
type QuitHandler = () => void | Promise<void>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function lifecycleAdapters(options: { pendingQuit?: boolean } = {}) {
  const events: string[] = [];
  let closeHandler: CloseHandler | null = null;
  let quitHandler: QuitHandler | null = null;
  return {
    events,
    mainWindow: {
      onCloseRequested: vi.fn(async (handler: CloseHandler) => {
        events.push('listen:close');
        closeHandler = handler;
        return vi.fn();
      }),
      destroy: vi.fn(async () => {
        events.push('destroy');
      }),
    },
    listen: vi.fn(async (event: string, handler: QuitHandler) => {
      events.push(`listen:${event}`);
      quitHandler = handler;
      return vi.fn();
    }),
    takePendingApplicationQuit: vi.fn(async () => {
      events.push('take:quit');
      return options.pendingQuit ?? false;
    }),
    requestClose: async () => {
      await closeHandler?.({
        preventDefault: () => {
          events.push('prevent');
        },
      });
    },
    requestQuit: async () => {
      await quitHandler?.();
    },
  };
}

describe('application shutdown lifecycle', () => {
  it('blocks dirty development Documents before teardown starts and remains usable', async () => {
    let dirty = true;
    const close = vi.fn(async () => undefined);
    const started = vi.fn();
    const coordinator = createApplicationShutdownCoordinator({
      canShutdown: () => !dirty,
      flush: async () => undefined,
      closeMainWindow: close,
      quitApplication: close,
      onShutdownStarted: started,
    });
    coordinator.markReady();
    await coordinator.request('quit-application');
    expect(close).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
    expect(coordinator.isShutdownRequested()).toBe(false);
    dirty = false;
    await coordinator.request('close-main-window');
    expect(close).toHaveBeenCalledOnce();
  });

  it('cancels teardown if a pending UI edit becomes dirty during the final flush', async () => {
    let dirty = false;
    const close = vi.fn(async () => undefined);
    const cancelled = vi.fn();
    const coordinator = createApplicationShutdownCoordinator({
      canShutdown: () => !dirty,
      flush: async () => {
        dirty = true;
      },
      closeMainWindow: close,
      quitApplication: close,
      onShutdownCancelled: cancelled,
    });
    coordinator.markReady();
    await coordinator.request('quit-application');
    expect(close).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(coordinator.isShutdownRequested()).toBe(false);
  });

  it('registers close and Quit before retaining an initialization-time Quit', async () => {
    const adapters = lifecycleAdapters({ pendingQuit: true });
    const flush = vi.fn(async () => {
      adapters.events.push('flush');
    });
    const quit = vi.fn(async () => {
      adapters.events.push('quit');
    });
    const coordinator = createApplicationShutdownCoordinator({
      flush,
      closeMainWindow: adapters.mainWindow.destroy,
      quitApplication: quit,
    });

    await registerApplicationShutdownHandlers({
      mainWindow: adapters.mainWindow,
      listen: adapters.listen,
      takePendingApplicationQuit: adapters.takePendingApplicationQuit,
      coordinator,
    });

    expect(adapters.events).toEqual([
      'listen:close',
      'listen:application-quit-requested',
      'take:quit',
    ]);
    expect(coordinator.isShutdownRequested()).toBe(true);
    expect(flush).not.toHaveBeenCalled();

    coordinator.markReady();
    await coordinator.completion();

    expect(adapters.events).toEqual([
      'listen:close',
      'listen:application-quit-requested',
      'take:quit',
      'flush',
      'quit',
    ]);
  });

  it('prevents an initialization-time close until persistence becomes ready', async () => {
    const adapters = lifecycleAdapters();
    const flush = vi.fn(async () => {
      adapters.events.push('flush');
    });
    const coordinator = createApplicationShutdownCoordinator({
      flush,
      closeMainWindow: adapters.mainWindow.destroy,
      quitApplication: vi.fn(async () => undefined),
    });
    await registerApplicationShutdownHandlers({
      mainWindow: adapters.mainWindow,
      listen: adapters.listen,
      takePendingApplicationQuit: adapters.takePendingApplicationQuit,
      coordinator,
    });

    const close = adapters.requestClose();
    await Promise.resolve();

    expect(adapters.events).toContain('prevent');
    expect(flush).not.toHaveBeenCalled();
    expect(adapters.mainWindow.destroy).not.toHaveBeenCalled();

    coordinator.markReady();
    await close;

    expect(flush).toHaveBeenCalledOnce();
    expect(adapters.mainWindow.destroy).toHaveBeenCalledOnce();
  });

  it('coalesces repeated mixed requests and gives whole-app Quit precedence', async () => {
    const adapters = lifecycleAdapters();
    const finalFlush = deferred();
    const flush = vi.fn(async () => {
      adapters.events.push('flush:start');
      await finalFlush.promise;
      adapters.events.push('flush:done');
    });
    const quit = vi.fn(async () => {
      adapters.events.push('quit');
    });
    const coordinator = createApplicationShutdownCoordinator({
      flush,
      closeMainWindow: adapters.mainWindow.destroy,
      quitApplication: quit,
    });
    await registerApplicationShutdownHandlers({
      mainWindow: adapters.mainWindow,
      listen: adapters.listen,
      takePendingApplicationQuit: adapters.takePendingApplicationQuit,
      coordinator,
    });
    coordinator.markReady();

    const close = adapters.requestClose();
    await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce());
    const repeatedClose = adapters.requestClose();
    const quitRequest = adapters.requestQuit();

    expect(adapters.mainWindow.destroy).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    finalFlush.resolve();
    await Promise.all([close, repeatedClose, quitRequest]);

    expect(flush).toHaveBeenCalledOnce();
    expect(adapters.mainWindow.destroy).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledOnce();
    expect(adapters.events.filter((event) => event === 'prevent')).toHaveLength(2);
  });

  it('freezes the teardown effect once final persistence completes', async () => {
    const adapters = lifecycleAdapters();
    const finishDestroy = deferred();
    adapters.mainWindow.destroy.mockImplementationOnce(async () => finishDestroy.promise);
    const quit = vi.fn(async () => undefined);
    const coordinator = createApplicationShutdownCoordinator({
      flush: vi.fn(async () => undefined),
      closeMainWindow: adapters.mainWindow.destroy,
      quitApplication: quit,
    });
    await registerApplicationShutdownHandlers({
      mainWindow: adapters.mainWindow,
      listen: adapters.listen,
      takePendingApplicationQuit: adapters.takePendingApplicationQuit,
      coordinator,
    });
    coordinator.markReady();

    const close = adapters.requestClose();
    await vi.waitFor(() => expect(adapters.mainWindow.destroy).toHaveBeenCalledOnce());
    const lateQuit = adapters.requestQuit();
    finishDestroy.resolve();
    await Promise.all([close, lateQuit]);

    expect(quit).not.toHaveBeenCalled();
  });

  it('retries one final persistence flow before closing the main window', async () => {
    const adapters = lifecycleAdapters();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flush = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('store unavailable'))
      .mockResolvedValueOnce(undefined);
    const choose = vi.fn(async () => 'retry' as const);
    const coordinator = createApplicationShutdownCoordinator({
      flush,
      chooseAfterFailure: choose,
      closeMainWindow: adapters.mainWindow.destroy,
      quitApplication: vi.fn(async () => undefined),
    });
    await registerApplicationShutdownHandlers({
      mainWindow: adapters.mainWindow,
      listen: adapters.listen,
      takePendingApplicationQuit: adapters.takePendingApplicationQuit,
      coordinator,
    });
    coordinator.markReady();

    await adapters.requestClose();

    expect(flush).toHaveBeenCalledTimes(2);
    expect(choose).toHaveBeenCalledOnce();
    expect(adapters.mainWindow.destroy).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('only tears down with dirty state after an explicit discard choice', async () => {
    const adapters = lifecycleAdapters();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flush = vi.fn(async () => {
      throw new Error('store unavailable');
    });
    const choose = vi.fn(async () => 'discard' as const);
    const coordinator = createApplicationShutdownCoordinator({
      flush,
      chooseAfterFailure: choose,
      closeMainWindow: adapters.mainWindow.destroy,
      quitApplication: vi.fn(async () => undefined),
    });
    await registerApplicationShutdownHandlers({
      mainWindow: adapters.mainWindow,
      listen: adapters.listen,
      takePendingApplicationQuit: adapters.takePendingApplicationQuit,
      coordinator,
    });
    coordinator.markReady();

    await adapters.requestClose();

    expect(flush).toHaveBeenCalledOnce();
    expect(choose).toHaveBeenCalledOnce();
    expect(adapters.mainWindow.destroy).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('does not enter shutdown when an auxiliary window closes', async () => {
    const adapters = lifecycleAdapters();
    const settingsWindow = lifecycleAdapters().mainWindow;
    const flush = vi.fn(async () => undefined);
    const coordinator = createApplicationShutdownCoordinator({
      flush,
      closeMainWindow: adapters.mainWindow.destroy,
      quitApplication: vi.fn(async () => undefined),
    });

    await registerApplicationShutdownHandlers({
      mainWindow: adapters.mainWindow,
      listen: adapters.listen,
      takePendingApplicationQuit: adapters.takePendingApplicationQuit,
      coordinator,
    });

    expect(adapters.mainWindow.onCloseRequested).toHaveBeenCalledOnce();
    expect(settingsWindow.onCloseRequested).not.toHaveBeenCalled();
    expect(coordinator.isShutdownRequested()).toBe(false);
    expect(flush).not.toHaveBeenCalled();
  });
});
