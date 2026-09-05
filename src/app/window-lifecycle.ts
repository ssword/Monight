import type {
  DocumentIntake,
  DocumentIntakeOperation,
  DocumentIntakeOutcome,
  DocumentIntakeResult,
} from '../reader/document-intake';

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
  flush: () => Promise<void>;
  closeMainWindow: () => Promise<void>;
  quitApplication: () => Promise<void>;
  chooseAfterFailure?: (error: unknown) => Promise<FinalSaveFailureChoice>;
  onShutdownStarted?: () => void;
}

export interface ApplicationShutdownCoordinator {
  request(request: ApplicationShutdownRequest): Promise<void>;
  markReady(): void;
  isShutdownRequested(): boolean;
  completion(): Promise<void> | null;
}

export interface ShutdownAwareDocumentIntake extends DocumentIntake {
  quiesce(): Promise<void>;
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

class ApplicationShuttingDownError extends Error {
  constructor() {
    super('Application shutdown is already in progress');
  }
}

export async function finishPendingPersistence(
  saveReadingSession: () => Promise<void>,
  chooseAfterFailure: (error: unknown) => Promise<FinalSaveFailureChoice>,
): Promise<void> {
  while (true) {
    try {
      await saveReadingSession();
      return;
    } catch (error) {
      console.error('Failed to save reader state before exit:', error);
      if ((await chooseAfterFailure(error)) === 'discard') return;
    }
  }
}

export function createApplicationShutdownCoordinator({
  flush,
  closeMainWindow,
  quitApplication,
  chooseAfterFailure = async () => 'discard',
  onShutdownStarted,
}: ApplicationShutdownCoordinatorOptions): ApplicationShutdownCoordinator {
  let requestedEffect: ApplicationShutdownRequest | null = null;
  let operation: Promise<void> | null = null;
  let releaseReady!: () => void;
  let ready = false;
  const readyPromise = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });
  const quitWasRequested = (): boolean => requestedEffect === 'quit-application';

  const request = (next: ApplicationShutdownRequest): Promise<void> => {
    const firstRequest = requestedEffect === null;
    if (requestedEffect !== 'quit-application') requestedEffect = next;
    if (firstRequest) onShutdownStarted?.();

    operation ??= (async () => {
      await readyPromise;
      await finishPendingPersistence(flush, chooseAfterFailure);

      if (quitWasRequested()) {
        await quitApplication();
        return;
      }

      await closeMainWindow();
      if (quitWasRequested()) await quitApplication();
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

function rejectedIntakeResult(paths: readonly string[]): DocumentIntakeResult {
  const outcomes: DocumentIntakeOutcome[] = paths.map((requestedPath) => ({
    status: 'failed',
    requestedPath,
    error: new ApplicationShuttingDownError(),
  }));
  return { outcomes, opened: 0, activated: 0, failed: outcomes.length };
}

export function createShutdownAwareDocumentIntake(
  intake: DocumentIntake,
  isAccepting: () => boolean,
): ShutdownAwareDocumentIntake {
  const pending = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    );
    return work;
  };
  const rejectedOperation = (paths: readonly string[]): DocumentIntakeOperation => {
    const result = rejectedIntakeResult(paths);
    return {
      foreground: Promise.resolve(result.outcomes[0] ?? null),
      completion: Promise.resolve(result),
    };
  };

  return {
    begin(paths, options) {
      if (!isAccepting()) return rejectedOperation(paths);
      const operation = intake.begin(paths, options);
      return { ...operation, completion: track(operation.completion) };
    },
    open(paths, options) {
      return isAccepting()
        ? track(intake.open(paths, options))
        : Promise.resolve(rejectedIntakeResult(paths));
    },
    restore: intake.restore.bind(intake),
    async quiesce() {
      while (pending.size > 0) {
        await Promise.allSettled(Array.from(pending));
      }
    },
  };
}
