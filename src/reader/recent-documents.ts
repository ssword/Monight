import {
  createDurableAuthorityPersistence,
  type DurableAuthorityConflictPolicy,
  type DurableAuthorityMessages,
  type DurableAuthorityRecovery,
  recoverDurableAuthority,
} from './durable-authority-persistence';

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

class RecentDocumentPersistenceConflictError extends Error {}

const PERSISTENCE_CONFLICTS: DurableAuthorityConflictPolicy = {
  create: (message) => new RecentDocumentPersistenceConflictError(message),
  isRetryable: (error) => !(error instanceof RecentDocumentPersistenceConflictError),
  reportInvalidDedicatedOnReadFailure: true,
};
const PERSISTENCE_MESSAGES: DurableAuthorityMessages = {
  invalidDedicatedValue: 'Dedicated Recent Documents state is invalid',
  unreconciledDedicatedValue:
    'Dedicated Recent Documents state could not be reconciled after a failed read',
  invalidDedicatedSchema: 'Dedicated Recent Documents state has an unsupported or invalid schema',
  unsafeDedicatedReplacement: 'Dedicated Recent Documents state could not be safely replaced',
  migrationVerificationFailed: 'Recent Documents migration could not be verified',
};

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
  recovery: DurableAuthorityRecovery<PersistedRecentDocuments>,
  {
    limit,
    debounceMs,
    retryMs,
    onPersistenceError,
    onChanged,
    onObserverError,
  }: Required<LoadRecentDocumentsOptions>,
): RecentDocumentAuthority {
  let documents = cloneDocuments(recovery.value.documents).slice(0, limit);
  let revision = 0;

  const notifyChanged = (): void => {
    try {
      onChanged(cloneDocuments(documents));
    } catch (error) {
      onObserverError(error);
    }
  };

  const persistence = createDurableAuthorityPersistence({
    storage,
    recovery,
    revision: () => revision,
    value: () => ({ schemaVersion: 1 as const, documents: cloneDocuments(documents) }),
    adoptDedicated(value) {
      documents = cloneDocuments(value.documents).slice(0, limit);
      notifyChanged();
    },
    parseDedicated: parseRecentDocuments,
    equals: collectionsEqual,
    messages: PERSISTENCE_MESSAGES,
    conflicts: PERSISTENCE_CONFLICTS,
    debounceMs,
    retryMs,
    onPersistenceError,
  });

  const replaceDocuments = (next: readonly RecentDocument[]): void => {
    documents = cloneDocuments(next).slice(0, limit);
    revision += 1;
    notifyChanged();
    persistence.changed();
  };

  return {
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
    flush: () => persistence.flush(),
    isDirty: () => persistence.isDirty(),
  };
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
  const recovery = await recoverDurableAuthority({
    storage,
    empty: { schemaVersion: 1, documents: [] },
    parseDedicated: parseRecentDocuments,
    parseLegacy: (value) => parseLegacyRecentDocuments(value, normalizedLimit),
    equals: collectionsEqual,
    messages: PERSISTENCE_MESSAGES,
    conflicts: PERSISTENCE_CONFLICTS,
    onPersistenceError,
  });
  return createRecentDocumentAuthority(storage, recovery, options);
}
