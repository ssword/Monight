export interface CloseRequestedEventLike {
  preventDefault(): void;
}

export interface ClosableWindow {
  onCloseRequested(
    handler: (event: CloseRequestedEventLike) => void | Promise<void>,
  ): Promise<() => void>;
  destroy(): Promise<void>;
}

/** Finish the final Reading Session save before allowing the app window to disappear. */
export async function registerReadingSessionCloseGuard(
  appWindow: ClosableWindow,
  saveReadingSession: () => Promise<void>,
): Promise<() => void> {
  let closing = false;

  return appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;

    try {
      await saveReadingSession();
    } catch (error) {
      console.error('Failed to save Reading Session before close:', error);
    }

    await appWindow.destroy();
  });
}
