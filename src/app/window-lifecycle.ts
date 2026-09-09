export interface CloseRequestedEventLike {
  preventDefault(): void;
}

export interface ClosableWindow {
  onCloseRequested(
    handler: (event: CloseRequestedEventLike) => void | Promise<void>,
  ): Promise<() => void>;
  destroy(): Promise<void>;
}

export type FinalSaveFailureChoice = 'retry' | 'discard';
export type ApplicationShutdownRequest = 'close-main-window' | 'quit-application';

interface ApplicationShutdownCoordinatorOptions {
  canShutdown?: () => boolean;
  flush: () => Promise<void>;
  closeMainWindow: () => Promise<void>;
  quitApplication: () => Promise<void>;
  chooseAfterFailure?: (error: unknown) => Promise<FinalSaveFailureChoice>;
  onShutdownStarted?: () => void;
  onShutdownCancelled?: () => void;
}

export interface ApplicationShutdownCoordinator {
  request(request: ApplicationShutdownRequest): Promise<void>;
  markReady(): void;
  isShutdownRequested(): boolean;
  completion(): Promise<void> | null;
}

interface RegisterApplicationShutdownHandlersOptions {
  mainWindow: ClosableWindow;
  listen(
    event: 'application-quit-requested',
    handler: () => void | Promise<void>,
  ): Promise<() => void>;
  takePendingApplicationQuit(): Promise<boolean>;
  coordinator: ApplicationShutdownCoordinator;
}

async function completeFinalPersistence(
  flushDurableAuthorities: () => Promise<void>,
  chooseAfterFailure: (error: unknown) => Promise<FinalSaveFailureChoice>,
): Promise<void> {
  while (true) {
    try {
      await flushDurableAuthorities();
      return;
    } catch (error) {
      console.error(
        'Failed to flush Reading Session, Annotations, or Recent Documents before exit:',
        error,
      );
      if ((await chooseAfterFailure(error)) === 'discard') return;
    }
  }
}

export function createApplicationShutdownCoordinator({
  flush,
  canShutdown,
  closeMainWindow,
  quitApplication,
  chooseAfterFailure = async () => 'discard',
  onShutdownStarted,
  onShutdownCancelled,
}: ApplicationShutdownCoordinatorOptions): ApplicationShutdownCoordinator {
  let requestedEffect: ApplicationShutdownRequest | null = null;
  let teardownEffect: ApplicationShutdownRequest | null = null;
  let operation: Promise<void> | null = null;
  let releaseReady!: () => void;
  let ready = false;
  const readyPromise = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });
  const quitWasRequested = (): boolean => requestedEffect === 'quit-application';

  const request = (next: ApplicationShutdownRequest): Promise<void> => {
    if (requestedEffect === null && canShutdown?.() === false) return Promise.resolve();
    const firstRequest = requestedEffect === null;
    if (teardownEffect === null && requestedEffect !== 'quit-application') requestedEffect = next;
    if (firstRequest) onShutdownStarted?.();

    operation ??= (async () => {
      await readyPromise;
      await completeFinalPersistence(flush, chooseAfterFailure);
      if (canShutdown?.() === false) {
        requestedEffect = null;
        operation = null;
        onShutdownCancelled?.();
        return;
      }
      teardownEffect = quitWasRequested() ? 'quit-application' : 'close-main-window';

      if (teardownEffect === 'quit-application') {
        await quitApplication();
        return;
      }

      await closeMainWindow();
    })();
    return operation;
  };

  return {
    request,
    markReady() {
      if (ready) return;
      ready = true;
      releaseReady();
    },
    isShutdownRequested: () => requestedEffect !== null,
    completion: () => operation,
  };
}

export async function registerApplicationShutdownHandlers({
  mainWindow,
  listen,
  takePendingApplicationQuit,
  coordinator,
}: RegisterApplicationShutdownHandlersOptions): Promise<() => void> {
  const releaseClose = await mainWindow.onCloseRequested((event) => {
    event.preventDefault();
    return coordinator.request('close-main-window');
  });
  const releaseQuit = await listen('application-quit-requested', () =>
    coordinator.request('quit-application'),
  );

  if (await takePendingApplicationQuit()) {
    void coordinator.request('quit-application');
  }

  return () => {
    releaseClose();
    releaseQuit();
  };
}
