interface AbortableWorkOptions<T> {
  readonly signal?: AbortSignal;
  readonly abortError: () => unknown;
  readonly onLateSuccess?: (value: T) => void | Promise<void>;
}

export function awaitAbortableWork<T>(
  work: Promise<T>,
  { signal, abortError, onLateSuccess }: AbortableWorkOptions<T>,
): Promise<T> {
  if (!signal) return work;

  const handleLateSuccess = (value: T): void => {
    if (!onLateSuccess) return;
    void Promise.resolve(onLateSuccess(value)).catch(() => undefined);
  };
  if (signal.aborted) {
    void work.then(handleLateSuccess, () => undefined);
    return Promise.reject(abortError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      complete();
    };
    const handleAbort = (): void => {
      finish(() => {
        void work.then(handleLateSuccess, () => undefined);
        reject(abortError());
      });
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    void work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
