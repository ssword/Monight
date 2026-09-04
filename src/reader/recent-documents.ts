export interface RecentDocument {
  readonly filePath: string;
  readonly title: string;
  readonly openedAt: number;
}

export interface PersistedRecentDocuments {
  readonly schemaVersion: 1;
  readonly documents: readonly RecentDocument[];
}

export interface RecentDocumentStorage {
  read(): Promise<unknown>;
  write(recentDocuments: PersistedRecentDocuments): Promise<void>;
  readLegacy(): Promise<unknown>;
  removeLegacy(): Promise<void>;
}

export interface RecentDocumentAuthority {
  snapshot(): readonly RecentDocument[];
  record(document: RecentDocument): void;
  clear(): void;
  flush(): Promise<void>;
  isDirty(): boolean;
}

interface LoadRecentDocumentsOptions {
  readonly limit?: number;
  readonly debounceMs?: number;
  readonly retryMs?: number;
  readonly onPersistenceError?: (error: unknown) => void;
  readonly onChanged?: (documents: readonly RecentDocument[]) => void;
  readonly onObserverError?: (error: unknown) => void;
}

type DedicatedWriteGuard = PersistedRecentDocuments | 'unknown' | null;

class RecentDocumentPersistenceConflictError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRecentDocument(value: unknown): RecentDocument | null {
  if (
    !isRecord(value) ||
    typeof value.filePath !== 'string' ||
    value.filePath.length === 0 ||
    typeof value.title !== 'string' ||
    value.title.length === 0 ||
    typeof value.openedAt !== 'number' ||
    !Number.isFinite(value.openedAt)
  ) {
    return null;
  }
  return { filePath: value.filePath, title: value.title, openedAt: value.openedAt };
}

function parseDocumentList(value: unknown): RecentDocument[] | null {
  if (!Array.isArray(value)) return null;
  const documents = value.map(parseRecentDocument);
  if (documents.some((document) => document === null)) return null;
  const validDocuments = documents as RecentDocument[];
  const paths = validDocuments.map((document) => document.filePath);
  return new Set(paths).size === paths.length ? validDocuments : null;
}

export function parseRecentDocuments(value: unknown): PersistedRecentDocuments | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const documents = parseDocumentList(value.documents);
  return documents ? { schemaVersion: 1, documents } : null;
}

function parseLegacyRecentDocuments(
  value: unknown,
  limit: number,
): PersistedRecentDocuments | null {
  if (!Array.isArray(value)) return null;
  if (limit === 0) return { schemaVersion: 1, documents: [] };
  const documents: RecentDocument[] = [];
  const seen = new Set<string>();
  for (const rawDocument of value) {
    const document = parseRecentDocument(rawDocument);
    if (!document) return null;
    if (seen.has(document.filePath)) continue;
    seen.add(document.filePath);
    documents.push(document);
    if (documents.length === limit) break;
  }
  return { schemaVersion: 1, documents };
}

function cloneDocuments(documents: readonly RecentDocument[]): RecentDocument[] {
  return documents.map((document) => ({ ...document }));
}

function collectionsEqual(
  left: PersistedRecentDocuments,
  right: PersistedRecentDocuments,
): boolean {
  return (
    left.documents.length === right.documents.length &&
    left.documents.every((document, index) => {
      const other = right.documents[index];
      return (
        other !== undefined &&
        document.filePath === other.filePath &&
        document.title === other.title &&
        document.openedAt === other.openedAt
      );
    })
  );
}

function createRecentDocumentAuthority(
  storage: RecentDocumentStorage,
  initial: PersistedRecentDocuments,
  {
    limit,
    debounceMs,
    retryMs,
    onPersistenceError,
    onChanged,
    onObserverError,
    initiallyPersisted,
    legacyCleanupPending,
    writeGuard,
  }: Required<LoadRecentDocumentsOptions> & {
    readonly initiallyPersisted: boolean;
    readonly legacyCleanupPending: boolean;
    readonly writeGuard: DedicatedWriteGuard;
  },
): RecentDocumentAuthority {
  let documents = cloneDocuments(initial.documents).slice(0, limit);
  let revision = 0;
  let persistedRevision = initiallyPersisted ? 0 : -1;
  let persistence: Promise<void> | null = null;
  let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldRemoveLegacy = legacyCleanupPending;
  let requiredDedicatedValue = writeGuard;

  const notifyChanged = (): void => {
    try {
      onChanged(cloneDocuments(documents));
    } catch (error) {
      onObserverError(error);
    }
  };

  const clearPersistenceTimer = (): void => {
    if (persistenceTimer === null) return;
    clearTimeout(persistenceTimer);
    persistenceTimer = null;
  };

  const persistDirtySnapshots = (): Promise<void> => {
    if (persistence) return persistence;
    const running = (async () => {
      while (persistedRevision < revision) {
        const targetRevision = revision;
        const value: PersistedRecentDocuments = {
          schemaVersion: 1,
          documents: cloneDocuments(documents),
        };
        if (requiredDedicatedValue) {
          const rawDedicated = await storage.read();
          if (rawDedicated !== undefined) {
            const dedicated = parseRecentDocuments(rawDedicated);
            if (!dedicated) {
              throw new RecentDocumentPersistenceConflictError(
                'Dedicated Recent Documents state is invalid',
              );
            }
            if (requiredDedicatedValue === 'unknown' && targetRevision === 0) {
              documents = cloneDocuments(dedicated.documents).slice(0, limit);
              persistedRevision = 0;
              requiredDedicatedValue = null;
              notifyChanged();
              continue;
            }
            if (
              requiredDedicatedValue === 'unknown' ||
              !collectionsEqual(dedicated, requiredDedicatedValue)
            ) {
              throw new RecentDocumentPersistenceConflictError(
                'Dedicated Recent Documents state could not be reconciled after a failed read',
              );
            }
          } else if (requiredDedicatedValue === 'unknown' && targetRevision === 0) {
            persistedRevision = 0;
            requiredDedicatedValue = null;
            continue;
          }
          requiredDedicatedValue = null;
        }
        await storage.write(value);
        if (shouldRemoveLegacy) {
          const verified = parseRecentDocuments(await storage.read());
          if (!verified || !collectionsEqual(verified, value)) {
            throw new Error('Recent Documents migration could not be verified');
          }
          try {
            await storage.removeLegacy();
            shouldRemoveLegacy = false;
          } catch {
            // The verified dedicated value remains authoritative; retry cleanup next launch.
          }
        }
        persistedRevision = targetRevision;
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

  const isRetryable = (error: unknown): boolean =>
    !(error instanceof RecentDocumentPersistenceConflictError);

  const schedulePersistence = (delayMs: number): void => {
    clearPersistenceTimer();
    persistenceTimer = setTimeout(() => {
      persistenceTimer = null;
      void persistDirtySnapshots().catch((error) => {
        onPersistenceError(error);
        if (isRetryable(error)) schedulePersistence(retryMs);
      });
    }, delayMs);
  };

  const replaceDocuments = (next: readonly RecentDocument[]): void => {
    documents = cloneDocuments(next).slice(0, limit);
    revision += 1;
    notifyChanged();
    schedulePersistence(debounceMs);
  };

  const authority: RecentDocumentAuthority = {
    snapshot: () => cloneDocuments(documents),
    record(document) {
      replaceDocuments([
        document,
        ...documents.filter((recent) => recent.filePath !== document.filePath),
      ]);
    },
    clear() {
      replaceDocuments([]);
    },
    async flush() {
      clearPersistenceTimer();
      try {
        while (persistedRevision < revision) await persistDirtySnapshots();
      } catch (error) {
        onPersistenceError(error);
        if (isRetryable(error)) schedulePersistence(retryMs);
        throw error;
      }
    },
    isDirty: () => persistedRevision < revision,
  };
  if (!initiallyPersisted) schedulePersistence(retryMs);
  return authority;
}

export async function loadRecentDocuments(
  storage: RecentDocumentStorage,
  {
    limit = 8,
    debounceMs = 0,
    retryMs = 1_000,
    onPersistenceError = () => undefined,
    onChanged = () => undefined,
    onObserverError = (error) => console.error('Recent Documents observer failed:', error),
  }: LoadRecentDocumentsOptions = {},
): Promise<RecentDocumentAuthority> {
  const normalizedLimit = Math.max(0, limit);
  const options = {
    limit: normalizedLimit,
    debounceMs,
    retryMs,
    onPersistenceError,
    onChanged,
    onObserverError,
  };
  let rawStored: unknown;
  let storedReadFailed = false;
  try {
    rawStored = await storage.read();
  } catch (error) {
    storedReadFailed = true;
    onPersistenceError(error);
  }

  const stored = parseRecentDocuments(rawStored);
  const dedicatedStateUnavailable = storedReadFailed || rawStored !== undefined;
  if (stored) {
    if ((await storage.readLegacy().catch(() => undefined)) !== undefined) {
      try {
        await storage.removeLegacy();
      } catch {
        return createRecentDocumentAuthority(storage, stored, {
          ...options,
          initiallyPersisted: true,
          legacyCleanupPending: true,
          writeGuard: null,
        });
      }
    }
    return createRecentDocumentAuthority(storage, stored, {
      ...options,
      initiallyPersisted: true,
      legacyCleanupPending: false,
      writeGuard: null,
    });
  }

  let rawLegacy: unknown;
  try {
    rawLegacy = await storage.readLegacy();
  } catch (error) {
    onPersistenceError(error);
  }
  const legacy = parseLegacyRecentDocuments(rawLegacy, normalizedLimit);
  if (!legacy) {
    if (dedicatedStateUnavailable) {
      onPersistenceError(
        new RecentDocumentPersistenceConflictError(
          'Dedicated Recent Documents state has an unsupported or invalid schema',
        ),
      );
    }
    return createRecentDocumentAuthority(
      storage,
      { schemaVersion: 1, documents: [] },
      {
        ...options,
        initiallyPersisted: !dedicatedStateUnavailable,
        legacyCleanupPending: false,
        writeGuard: dedicatedStateUnavailable ? 'unknown' : null,
      },
    );
  }

  try {
    if (dedicatedStateUnavailable) {
      throw new RecentDocumentPersistenceConflictError(
        'Dedicated Recent Documents state could not be safely replaced',
      );
    }
    await storage.write(legacy);
    const verified = parseRecentDocuments(await storage.read());
    if (!verified || !collectionsEqual(verified, legacy)) {
      throw new Error('Recent Documents migration could not be verified');
    }
    let legacyCleanupPending = false;
    try {
      await storage.removeLegacy();
    } catch {
      legacyCleanupPending = true;
    }
    return createRecentDocumentAuthority(storage, verified, {
      ...options,
      initiallyPersisted: true,
      legacyCleanupPending,
      writeGuard: null,
    });
  } catch (error) {
    onPersistenceError(error);
    return createRecentDocumentAuthority(storage, legacy, {
      ...options,
      initiallyPersisted: false,
      legacyCleanupPending: true,
      writeGuard: dedicatedStateUnavailable ? legacy : null,
    });
  }
}
