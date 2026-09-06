export interface DurableAuthorityStorage<T> {
  read(): Promise<unknown>;
  write(value: T): Promise<void>;
  readLegacy(): Promise<unknown>;
  removeLegacy(): Promise<void>;
}

export interface DurableAuthorityMessages {
  readonly invalidDedicatedValue: string;
  readonly unreconciledDedicatedValue: string;
  readonly invalidDedicatedSchema: string;
  readonly unsafeDedicatedReplacement: string;
  readonly migrationVerificationFailed: string;
}

export interface DurableAuthorityConflictPolicy {
  readonly create: (message: string) => Error;
  readonly isRetryable: (error: unknown) => boolean;
  readonly reportInvalidDedicatedOnReadFailure?: boolean;
}

type DedicatedWriteGuard<T> =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'expected'; readonly value: T }
  | null;

export interface DurableAuthorityRecovery<T> {
  readonly value: T;
  readonly initiallyPersisted: boolean;
  readonly legacyCleanupPending: boolean;
  readonly writeGuard: DedicatedWriteGuard<T>;
}

interface RecoverDurableAuthorityOptions<T> {
  readonly storage: DurableAuthorityStorage<T>;
  readonly empty: T;
  readonly parseDedicated: (value: unknown) => T | null;
  readonly parseLegacy: (value: unknown) => T | null;
  readonly equals: (left: T, right: T) => boolean;
  readonly messages: DurableAuthorityMessages;
  readonly conflicts: DurableAuthorityConflictPolicy;
  readonly onPersistenceError: (error: unknown) => void;
}

export async function recoverDurableAuthority<T>({
  storage,
  empty,
  parseDedicated,
  parseLegacy,
  equals,
  messages,
  conflicts,
  onPersistenceError,
}: RecoverDurableAuthorityOptions<T>): Promise<DurableAuthorityRecovery<T>> {
  let rawDedicated: unknown;
  let dedicatedReadFailed = false;
  try {
    rawDedicated = await storage.read();
  } catch (error) {
    dedicatedReadFailed = true;
    onPersistenceError(error);
  }

  const dedicated = parseDedicated(rawDedicated);
  const dedicatedStateMayExist = dedicatedReadFailed || rawDedicated !== undefined;
  if (dedicated) {
    const rawLegacy = await storage.readLegacy().catch(() => undefined);
    let legacyCleanupPending = false;
    if (rawLegacy !== undefined) {
      try {
        await storage.removeLegacy();
      } catch {
        legacyCleanupPending = true;
      }
    }
    return {
      value: dedicated,
      initiallyPersisted: true,
      legacyCleanupPending,
      writeGuard: null,
    };
  }

  let rawLegacy: unknown;
  try {
    rawLegacy = await storage.readLegacy();
  } catch (error) {
    onPersistenceError(error);
  }
  const legacy = parseLegacy(rawLegacy);
  if (!legacy) {
    if (
      dedicatedStateMayExist &&
      (!dedicatedReadFailed || conflicts.reportInvalidDedicatedOnReadFailure)
    ) {
      onPersistenceError(conflicts.create(messages.invalidDedicatedSchema));
    }
    return {
      value: empty,
      initiallyPersisted: !dedicatedStateMayExist,
      legacyCleanupPending: false,
      writeGuard: dedicatedStateMayExist ? { kind: 'unknown' } : null,
    };
  }

  try {
    if (dedicatedStateMayExist) {
      throw conflicts.create(messages.unsafeDedicatedReplacement);
    }
    await storage.write(legacy);
    const verified = parseDedicated(await storage.read());
    if (!verified || !equals(verified, legacy)) {
      throw new Error(messages.migrationVerificationFailed);
    }
    let legacyCleanupPending = false;
    try {
      await storage.removeLegacy();
    } catch {
      legacyCleanupPending = true;
    }
    return {
      value: verified,
      initiallyPersisted: true,
      legacyCleanupPending,
      writeGuard: null,
    };
  } catch (error) {
    onPersistenceError(error);
    return {
      value: legacy,
      initiallyPersisted: false,
      legacyCleanupPending: true,
      writeGuard: { kind: 'expected', value: legacy },
    };
  }
}

interface CreateDurableAuthorityPersistenceOptions<T> {
  readonly storage: DurableAuthorityStorage<T>;
  readonly recovery: DurableAuthorityRecovery<T>;
  readonly revision: () => number;
  readonly value: () => T;
  readonly adoptDedicated: (value: T) => void;
  readonly parseDedicated: (value: unknown) => T | null;
  readonly equals: (left: T, right: T) => boolean;
  readonly messages: DurableAuthorityMessages;
  readonly conflicts: DurableAuthorityConflictPolicy;
  readonly debounceMs: number;
  readonly retryMs: number;
  readonly onPersistenceError: (error: unknown) => void;
}

export interface DurableAuthorityPersistence {
  changed(): void;
  flush(): Promise<void>;
  isDirty(): boolean;
}

export function createDurableAuthorityPersistence<T>({
  storage,
  recovery,
  revision,
  value,
  adoptDedicated,
  parseDedicated,
  equals,
  messages,
  conflicts,
  debounceMs,
  retryMs,
  onPersistenceError,
}: CreateDurableAuthorityPersistenceOptions<T>): DurableAuthorityPersistence {
  let persistedRevision = recovery.initiallyPersisted ? 0 : -1;
  let persistence: Promise<void> | null = null;
  let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldRemoveLegacy = recovery.legacyCleanupPending;
  let requiredDedicatedValue = recovery.writeGuard;

  const clearPersistenceTimer = (): void => {
    if (persistenceTimer === null) return;
    clearTimeout(persistenceTimer);
    persistenceTimer = null;
  };

  const persistDirtyValues = (): Promise<void> => {
    if (persistence) return persistence;
    const running = (async () => {
      while (persistedRevision < revision()) {
        const target = { revision: revision(), value: value() };
        if (requiredDedicatedValue) {
          const rawDedicated = await storage.read();
          if (rawDedicated !== undefined) {
            const dedicated = parseDedicated(rawDedicated);
            if (!dedicated) {
              throw conflicts.create(messages.invalidDedicatedValue);
            }
            if (requiredDedicatedValue.kind === 'unknown' && target.revision === 0) {
              if (revision() !== target.revision) {
                throw conflicts.create(messages.unreconciledDedicatedValue);
              }
              adoptDedicated(dedicated);
              persistedRevision = 0;
              requiredDedicatedValue = null;
              continue;
            }
            if (
              requiredDedicatedValue.kind === 'unknown' ||
              !equals(dedicated, requiredDedicatedValue.value)
            ) {
              throw conflicts.create(messages.unreconciledDedicatedValue);
            }
          } else if (requiredDedicatedValue.kind === 'unknown' && target.revision === 0) {
            if (revision() !== target.revision) {
              requiredDedicatedValue = null;
              continue;
            }
            persistedRevision = 0;
            requiredDedicatedValue = null;
            continue;
          }
          requiredDedicatedValue = null;
        }

        await storage.write(target.value);
        if (shouldRemoveLegacy) {
          const verified = parseDedicated(await storage.read());
          if (!verified || !equals(verified, target.value)) {
            requiredDedicatedValue = { kind: 'expected', value: target.value };
            throw new Error(messages.migrationVerificationFailed);
          }
          try {
            await storage.removeLegacy();
            shouldRemoveLegacy = false;
          } catch {
            // The verified dedicated value is authoritative; retry cleanup after later work.
          }
        }
        persistedRevision = target.revision;
      }
    })();
    persistence = running;
    void running.then(
      () => {
        if (persistence === running) persistence = null;
      },
      () => {
        if (persistence === running) persistence = null;
      },
    );
    return running;
  };

  const schedulePersistence = (delayMs: number): void => {
    clearPersistenceTimer();
    persistenceTimer = setTimeout(() => {
      persistenceTimer = null;
      void persistDirtyValues().catch((error) => {
        onPersistenceError(error);
        if (conflicts.isRetryable(error)) schedulePersistence(retryMs);
      });
    }, delayMs);
  };

  if (!recovery.initiallyPersisted) schedulePersistence(retryMs);

  return {
    changed: () => schedulePersistence(debounceMs),
    async flush() {
      clearPersistenceTimer();
      try {
        while (persistedRevision < revision()) await persistDirtyValues();
      } catch (error) {
        onPersistenceError(error);
        if (conflicts.isRetryable(error)) schedulePersistence(retryMs);
        throw error;
      }
    },
    isDirty: () => persistedRevision < revision(),
  };
}
