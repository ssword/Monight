import type {
  PdfAnnotation,
  PdfAnnotationColor,
  PdfAnnotationKind,
} from '../lib/document-features';
import {
  createDurableAuthorityPersistence,
  type DurableAuthorityConflictPolicy,
  type DurableAuthorityMessages,
  type DurableAuthorityRecovery,
  recoverDurableAuthority,
} from './durable-authority-persistence';

export interface PersistedAnnotations {
  readonly schemaVersion: 1;
  readonly documents: Readonly<Record<string, readonly PdfAnnotation[]>>;
}

export interface AnnotationAccess {
  snapshot(filePath: string): readonly PdfAnnotation[];
  replace(filePath: string, annotations: readonly PdfAnnotation[]): void;
}

export interface AnnotationStorage {
  read(): Promise<unknown>;
  write(annotations: PersistedAnnotations): Promise<void>;
  readLegacy(): Promise<unknown>;
  removeLegacy(): Promise<void>;
}

export interface AnnotationAuthority extends AnnotationAccess {
  clear(): void;
  flush(): Promise<void>;
  isDirty(): boolean;
}

interface LoadAnnotationsOptions {
  readonly debounceMs?: number;
  readonly retryMs?: number;
  readonly onPersistenceError?: (error: unknown) => void;
  readonly onChanged?: (filePath: string | null) => void;
  readonly onObserverError?: (error: unknown) => void;
}

const ANNOTATION_KINDS = new Set<PdfAnnotationKind>(['highlight', 'note']);
const ANNOTATION_COLORS = new Set<PdfAnnotationColor>(['yellow', 'green', 'blue', 'pink']);
class AnnotationPersistenceConflictError extends Error {}

const PERSISTENCE_CONFLICTS: DurableAuthorityConflictPolicy = {
  create: (message) => new AnnotationPersistenceConflictError(message),
  isRetryable: (error) => !(error instanceof AnnotationPersistenceConflictError),
};
const PERSISTENCE_MESSAGES: DurableAuthorityMessages = {
  invalidDedicatedValue: 'Dedicated Annotation state is invalid',
  unreconciledDedicatedValue:
    'The dedicated Annotation state could not be reconciled after a failed read',
  invalidDedicatedSchema: 'Dedicated Annotation state has an unsupported or invalid schema',
  unsafeDedicatedReplacement: 'Dedicated Annotation state could not be safely replaced',
  migrationVerificationFailed: 'Annotation migration could not be verified',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseAnnotation(value: unknown): PdfAnnotation | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) return null;
  if (
    typeof value.kind !== 'string' ||
    !ANNOTATION_KINDS.has(value.kind as PdfAnnotationKind) ||
    typeof value.color !== 'string' ||
    !ANNOTATION_COLORS.has(value.color as PdfAnnotationColor)
  ) {
    return null;
  }
  if (
    !Number.isInteger(value.pageNumber) ||
    (value.pageNumber as number) < 1 ||
    typeof value.text !== 'string' ||
    typeof value.note !== 'string' ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt) ||
    !Array.isArray(value.rects)
  ) {
    return null;
  }

  const rects = value.rects.map((rect) => {
    if (
      !isRecord(rect) ||
      !isFiniteNumber(rect.x1) ||
      !isFiniteNumber(rect.y1) ||
      !isFiniteNumber(rect.x2) ||
      !isFiniteNumber(rect.y2)
    ) {
      return null;
    }
    return { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 };
  });
  if (rects.some((rect) => rect === null)) return null;

  return {
    id: value.id,
    kind: value.kind as PdfAnnotationKind,
    pageNumber: value.pageNumber as number,
    rects: rects as PdfAnnotation['rects'],
    text: value.text,
    note: value.note,
    color: value.color as PdfAnnotationColor,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseDocuments(value: unknown): Record<string, PdfAnnotation[]> | null {
  if (!isRecord(value)) return null;
  const documents: Record<string, PdfAnnotation[]> = {};
  for (const [filePath, rawAnnotations] of Object.entries(value)) {
    if (filePath.length === 0 || !Array.isArray(rawAnnotations)) return null;
    const annotations = rawAnnotations.map(parseAnnotation);
    if (annotations.some((annotation) => annotation === null)) return null;
    const validAnnotations = annotations as PdfAnnotation[];
    const ids = validAnnotations.map((annotation) => annotation.id);
    if (new Set(ids).size !== ids.length) return null;
    if (validAnnotations.length > 0) documents[filePath] = validAnnotations;
  }
  return documents;
}

export function parseAnnotations(value: unknown): PersistedAnnotations | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const documents = parseDocuments(value.documents);
  return documents ? { schemaVersion: 1, documents } : null;
}

function parseLegacyAnnotations(value: unknown): PersistedAnnotations | null {
  const documents = parseDocuments(value);
  return documents ? { schemaVersion: 1, documents } : null;
}

function cloneAnnotation(annotation: PdfAnnotation): PdfAnnotation {
  return {
    ...annotation,
    rects: annotation.rects.map((rect) => ({ ...rect })),
  };
}

function cloneDocuments(
  documents: Readonly<Record<string, readonly PdfAnnotation[]>>,
): Record<string, PdfAnnotation[]> {
  return Object.fromEntries(
    Object.entries(documents).map(([filePath, annotations]) => [
      filePath,
      annotations.map(cloneAnnotation),
    ]),
  );
}

function replaceDocumentAnnotations(
  documents: Readonly<Record<string, readonly PdfAnnotation[]>>,
  filePath: string,
  annotations: readonly PdfAnnotation[],
): Record<string, PdfAnnotation[]> {
  const next = cloneDocuments(documents);
  if (annotations.length === 0) {
    delete next[filePath];
  } else {
    next[filePath] = annotations.map(cloneAnnotation);
  }
  return next;
}

function persistedValue(
  documents: Readonly<Record<string, readonly PdfAnnotation[]>>,
): PersistedAnnotations {
  return { schemaVersion: 1, documents: cloneDocuments(documents) };
}

function collectionsEqual(left: PersistedAnnotations, right: PersistedAnnotations): boolean {
  const leftPaths = Object.keys(left.documents).sort();
  const rightPaths = Object.keys(right.documents).sort();
  if (
    leftPaths.length !== rightPaths.length ||
    leftPaths.some((filePath, index) => filePath !== rightPaths[index])
  ) {
    return false;
  }
  return leftPaths.every((filePath) => {
    const leftAnnotations = left.documents[filePath] ?? [];
    const rightAnnotations = right.documents[filePath] ?? [];
    if (leftAnnotations.length !== rightAnnotations.length) return false;
    return leftAnnotations.every((annotation, index) => {
      const other = rightAnnotations[index];
      return (
        other !== undefined &&
        annotation.id === other.id &&
        annotation.kind === other.kind &&
        annotation.pageNumber === other.pageNumber &&
        annotation.text === other.text &&
        annotation.note === other.note &&
        annotation.color === other.color &&
        annotation.createdAt === other.createdAt &&
        annotation.updatedAt === other.updatedAt &&
        annotation.rects.length === other.rects.length &&
        annotation.rects.every((rect, rectIndex) => {
          const otherRect = other.rects[rectIndex];
          return (
            otherRect !== undefined &&
            rect.x1 === otherRect.x1 &&
            rect.y1 === otherRect.y1 &&
            rect.x2 === otherRect.x2 &&
            rect.y2 === otherRect.y2
          );
        })
      );
    });
  });
}

function createAnnotationAuthority(
  storage: AnnotationStorage,
  recovery: DurableAuthorityRecovery<PersistedAnnotations>,
  {
    debounceMs,
    retryMs,
    onPersistenceError,
    onChanged,
    onObserverError,
  }: Required<LoadAnnotationsOptions>,
): AnnotationAuthority {
  let documents = cloneDocuments(recovery.value.documents);
  let revision = 0;

  const notifyChanged = (filePath: string | null): void => {
    try {
      onChanged(filePath);
    } catch (error) {
      onObserverError(error);
    }
  };

  const persistence = createDurableAuthorityPersistence({
    storage,
    recovery,
    revision: () => revision,
    value: () => persistedValue(documents),
    adoptDedicated(value) {
      documents = cloneDocuments(value.documents);
      notifyChanged(null);
    },
    parseDedicated: parseAnnotations,
    equals: collectionsEqual,
    messages: PERSISTENCE_MESSAGES,
    conflicts: PERSISTENCE_CONFLICTS,
    debounceMs,
    retryMs,
    onPersistenceError,
  });

  const replaceDocuments = (
    next: Readonly<Record<string, readonly PdfAnnotation[]>>,
    filePath: string | null,
  ): void => {
    documents = cloneDocuments(next);
    revision += 1;
    notifyChanged(filePath);
    persistence.changed();
  };

  return {
    snapshot(filePath) {
      return (documents[filePath] ?? []).map(cloneAnnotation);
    },
    replace(filePath, annotations) {
      replaceDocuments(replaceDocumentAnnotations(documents, filePath, annotations), filePath);
    },
    clear() {
      replaceDocuments({}, null);
    },
    flush: () => persistence.flush(),
    isDirty: () => persistence.isDirty(),
  };
}

export function createTransientAnnotationAccess(): AnnotationAccess {
  let documents: Record<string, PdfAnnotation[]> = {};
  return {
    snapshot(filePath) {
      return (documents[filePath] ?? []).map(cloneAnnotation);
    },
    replace(filePath, annotations) {
      documents = replaceDocumentAnnotations(documents, filePath, annotations);
    },
  };
}

export async function loadAnnotations(
  storage: AnnotationStorage,
  {
    debounceMs = 200,
    retryMs = 1_000,
    onPersistenceError = () => undefined,
    onChanged = () => undefined,
    onObserverError = (error) => console.error('Annotation observer failed:', error),
  }: LoadAnnotationsOptions = {},
): Promise<AnnotationAuthority> {
  const recovery = await recoverDurableAuthority({
    storage,
    empty: { schemaVersion: 1, documents: {} },
    parseDedicated: parseAnnotations,
    parseLegacy: parseLegacyAnnotations,
    equals: collectionsEqual,
    messages: PERSISTENCE_MESSAGES,
    conflicts: PERSISTENCE_CONFLICTS,
    onPersistenceError,
  });
  return createAnnotationAuthority(storage, recovery, {
    debounceMs,
    retryMs,
    onPersistenceError,
    onChanged,
    onObserverError,
  });
}
