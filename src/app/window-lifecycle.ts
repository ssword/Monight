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

export async function finishPendingReaderState(
  saveReadingSession: () => Promise<void>,
  chooseAfterFailure: (error: unknown) => Promise<FinalSaveFailureChoice>,
): Promise<void> {
  while (true) {
    try {
      await saveReadingSession();
      return;
    } catch (error) {
      console.error('Failed to save Reading Session before exit:', error);
      if ((await chooseAfterFailure(error)) === 'discard') return;
    }
  }
}

/** Finish the final Reading Session save before allowing the app window to disappear. */
export async function registerReadingSessionCloseGuard(
  appWindow: ClosableWindow,
  saveReadingSession: () => Promise<void>,
  chooseAfterFailure: (error: unknown) => Promise<FinalSaveFailureChoice> = async () => 'discard',
): Promise<() => void> {
  let closing = false;

  return appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;

    await finishPendingReaderState(saveReadingSession, chooseAfterFailure);
    await appWindow.destroy();
  });
}
