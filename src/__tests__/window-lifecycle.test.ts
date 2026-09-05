import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationShutdownCoordinator,
  createShutdownAwareDocumentIntake,
  registerApplicationShutdownHandlers,
} from '../app/window-lifecycle';
import type { DocumentIntake, DocumentIntakeOperation } from '../reader/document-intake';

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

  it('stops accepting new Document Intake while allowing accepted intake to settle', async () => {
    const acceptedCompletion = deferred<{
      outcomes: [];
      opened: number;
      activated: number;
      failed: number;
    }>();
    const operation: DocumentIntakeOperation = {
      foreground: Promise.resolve(null),
      completion: acceptedCompletion.promise,
    };
    const intake = {
      begin: vi.fn(() => operation),
      open: vi.fn(async () => operation.completion),
      restore: vi.fn(),
    } as unknown as DocumentIntake;
    let accepting = true;
    const guarded = createShutdownAwareDocumentIntake(intake, () => accepting);

    const accepted = guarded.begin(['/docs/accepted.pdf']);
    accepting = false;
    const rejected = guarded.begin(['/docs/rejected.pdf']);
    acceptedCompletion.resolve({ outcomes: [], opened: 1, activated: 0, failed: 0 });

    await expect(accepted.completion).resolves.toMatchObject({ opened: 1 });
    await expect(rejected.completion).resolves.toMatchObject({
      opened: 0,
      activated: 0,
      failed: 1,
    });
    expect(intake.begin).toHaveBeenCalledOnce();
  });

  it('waits for accepted Document Intake before starting final persistence', async () => {
    const acceptedCompletion = deferred<{
      outcomes: [];
      opened: number;
      activated: number;
      failed: number;
    }>();
    const intake = {
      begin: vi.fn(() => ({
        foreground: Promise.resolve(null),
        completion: acceptedCompletion.promise,
      })),
      open: vi.fn(),
      restore: vi.fn(),
    } as unknown as DocumentIntake;
    let accepting = true;
    const guarded = createShutdownAwareDocumentIntake(intake, () => accepting);
    const persist = vi.fn(async () => undefined);
    const coordinator = createApplicationShutdownCoordinator({
      flush: async () => {
        await guarded.quiesce();
        await persist();
      },
      closeMainWindow: vi.fn(async () => undefined),
      quitApplication: vi.fn(async () => undefined),
      onShutdownStarted: () => {
        accepting = false;
      },
    });

    const accepted = guarded.begin(['/docs/accepted.pdf']);
    const shutdown = coordinator.request('close-main-window');
    coordinator.markReady();
    await Promise.resolve();

    expect(persist).not.toHaveBeenCalled();
    acceptedCompletion.resolve({ outcomes: [], opened: 1, activated: 0, failed: 0 });
    await Promise.all([accepted.completion, shutdown]);

    expect(persist).toHaveBeenCalledOnce();
  });
});
