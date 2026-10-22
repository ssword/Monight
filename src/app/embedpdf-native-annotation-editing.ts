import {
  PdfAnnotationName,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfEngine,
  PdfErrorCode,
  type PdfTask,
  Task,
} from '@embedpdf/models';
import {
  type AnnotationCapability,
  type HistoryScope,
  PdfAnnotationSubtype,
  type Rotation,
  type TrackedAnnotation,
} from '@embedpdf/snippet';
import type {
  AnnotationEdit,
  NativePdfEditing,
  PageRotationDirection,
} from '../reader/native-pdf-editing';
import { embedPdfAnnotationToolIds } from './embedpdf-offline-configuration';
import {
  mapRegeneratedTextMarkupAppearance,
  type PendingMarkupAppearance,
} from './embedpdf-text-markup-appearance';

/** The fields a text markup's appearance is drawn from; any change regenerates it. */
const textMarkupAppearanceFields = [
  'rect',
  'segmentRects',
  'strokeColor',
  'opacity',
  'strokeWidth',
  'blendMode',
] as const;

/** The supported editable fields a saved Annotation must keep. */
const verifiedFields = [
  'id',
  'type',
  'pageIndex',
  'contents',
  'author',
  ...textMarkupAppearanceFields,
] as const;

/** Compare the supported editable fields, tolerating PDF float serialization only. */
function nativeAnnotationMatches(
  expected: TrackedAnnotation['object'],
  actual: TrackedAnnotation['object'],
  fields: readonly (typeof verifiedFields)[number][] = verifiedFields,
): boolean {
  const equal = (a: unknown, b: unknown): boolean => {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((value, index) => equal(value, b[index]));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return Object.entries(a).every(([key, value]) => equal(value, Reflect.get(b, key)));
    }
    return a === b;
  };
  return fields.every((field) => {
    const value = Reflect.get(expected, field);
    const saved = Reflect.get(actual, field);
    if (value === undefined) return true;
    if (field === 'strokeColor' && typeof value === 'string' && typeof saved === 'string')
      return value.toLowerCase() === saved.toLowerCase();
    // PDFium represents alpha in 8 bits.
    if (field === 'opacity' && typeof value === 'number' && typeof saved === 'number')
      return Math.round(value * 255) === Math.round(saved * 255);
    return equal(value, saved);
  });
}

// Plugin commit may swallow individual mutation failures. Keep failed appearance
// corrections, by Document and Annotation, until an export repairs them or fails
// before any bytes can be saved. One map per engine, whose appearance preservation
// is installed once.
const pendingMarkupAppearances = new WeakMap<PdfEngine, Map<string, PendingMarkupAppearance>>();

/** The icon a note displays: an absent or unrecognized /Name means the default /Note. */
function noteIcon({ name, icon }: { name?: PdfAnnotationName; icon?: PdfAnnotationName }) {
  const displayed = name ?? icon ?? PdfAnnotationName.Comment;
  return displayed === PdfAnnotationName.Unknown ? PdfAnnotationName.Note : displayed;
}

/**
 * Comment-only text-markup edits must keep their native appearance; actual visual
 * edits regenerate it and correct its coordinate box before saving (#119).
 * Keep a note's existing appearance stream, such as Preview's or Acrobat's own icon,
 * when an update leaves that icon unchanged. The pinned engine otherwise replaces it
 * with PDFium's 20pt icon on every contents edit. Writing an absent icon name (Preview
 * omits /Name) also deletes the stream, even with appearance regeneration disabled.
 */
function preserveNativeAnnotationAppearances(
  engine: PdfEngine,
): Map<string, PendingMarkupAppearance> {
  const installed = pendingMarkupAppearances.get(engine);
  if (installed) return installed;
  const pending = new Map<string, PendingMarkupAppearance>();
  pendingMarkupAppearances.set(engine, pending);
  const update = engine.updatePageAnnotation.bind(engine);
  engine.updatePageAnnotation = (doc, page, annotation, options) => {
    const textMarkup =
      annotation.type === PdfAnnotationSubtype.UNDERLINE ||
      annotation.type === PdfAnnotationSubtype.STRIKEOUT;
    if (annotation.type !== PdfAnnotationSubtype.TEXT && !textMarkup)
      return update(doc, page, annotation, options);
    if (textMarkup) {
      const task: PdfTask<boolean> = new Task();
      engine.getPageAnnotations(doc, page).wait(
        (native) => {
          const existing = native.find(({ id }) => id === annotation.id);
          const regenerateAppearance =
            options?.regenerateAppearance !== false &&
            !(
              existing?.type === annotation.type &&
              nativeAnnotationMatches(annotation, existing, textMarkupAppearanceFields)
            );
          update(doc, page, annotation, { ...options, regenerateAppearance }).wait(
            (ok) => {
              try {
                if (ok && regenerateAppearance) {
                  const key = `${doc.id}:${annotation.id}`;
                  const markup = { document: doc, page, annotationId: annotation.id };
                  pending.set(key, markup);
                  mapRegeneratedTextMarkupAppearance(engine, markup);
                  pending.delete(key);
                }
                task.resolve(ok);
              } catch (error) {
                task.reject({ code: PdfErrorCode.CantSetAnnotContent, message: String(error) });
              }
            },
            (error) => task.fail(error),
          );
        },
        (error) => task.fail(error),
      );
      return task;
    }
    const note: PdfAnnotationObject = { ...annotation, name: noteIcon(annotation) };
    const task: PdfTask<boolean> = new Task();
    engine.getPageAnnotations(doc, page).wait(
      (native) => {
        const existing = native.find(({ id }) => id === annotation.id);
        const regenerateAppearance =
          options?.regenerateAppearance !== false &&
          !(
            existing &&
            existing.type === PdfAnnotationSubtype.TEXT &&
            noteIcon(existing) === note.name &&
            nativeAnnotationMatches(annotation, existing, ['rect', 'strokeColor', 'opacity'])
          );
        update(doc, page, note, { regenerateAppearance }).wait(
          (ok) => task.resolve(ok),
          (error) => task.fail(error),
        );
      },
      (error) => task.fail(error),
    );
    return task;
  };
  return pending;
}

type SetPageRotation = (document: PdfDocumentObject, pageIndex: number, rotation: Rotation) => void;

/**
 * The single Page Rotation write mechanism: PDFium's own page-rotation setter on the live
 * Document. The pinned engine exposes no API for it, so this narrow adapter reaches the
 * direct (main-thread) executor. Everything that serializes the live Document (Save, Save
 * As, Recovery Drafts, printing) then carries the rotation through `saveAsCopy`.
 */
function pdfiumPageRotationSetter(engine: PdfEngine): SetPageRotation | null {
  const executor: unknown = Reflect.get(engine, 'executor');
  if (!executor || typeof executor !== 'object') return null;
  const pdfium: unknown = Reflect.get(executor, 'pdfiumModule');
  const cache: unknown = Reflect.get(executor, 'cache');
  const setRotation =
    pdfium && typeof pdfium === 'object' && Reflect.get(pdfium, 'FPDFPage_SetRotation');
  const getContext = cache && typeof cache === 'object' && Reflect.get(cache, 'getContext');
  if (typeof setRotation !== 'function' || typeof getContext !== 'function') return null;
  return (document, pageIndex, rotation) => {
    const context = getContext.call(cache, document.id) as
      | { acquirePage(index: number): { pagePtr: number; release(): void } }
      | undefined;
    if (!context) throw new Error('Page Rotation is unavailable: the Document is not open');
    const page = context.acquirePage(pageIndex);
    try {
      setRotation.call(pdfium, page.pagePtr, rotation);
    } finally {
      page.release();
    }
  };
}

export function createEmbedPdfNativeAnnotationEditing({
  annotations,
  annotationScope,
  currentDocument,
  engine,
  history,
  pageRotationChanged,
  readOnlyReason,
  stateChanged,
}: {
  annotations: AnnotationCapability;
  annotationScope: ReturnType<AnnotationCapability['forDocument']>;
  currentDocument: () => PdfDocumentObject;
  engine: PdfEngine;
  /** The viewer's undo timeline, shared with Annotation edits. */
  history?: HistoryScope;
  /** Re-lays out and re-renders pages whose live Page Rotation changed. */
  pageRotationChanged?: (pageIndexes: readonly number[]) => void;
  readOnlyReason: string | null;
  stateChanged: () => void;
}) {
  const pendingAppearances = preserveNativeAnnotationAppearances(engine);
  const setPageRotation = pdfiumPageRotationSetter(engine);
  // The viewer opens Documents with normalized rotation: Annotation geometry stays in
  // unrotated page space and each page's rotation is applied when laying it out. A Page
  // Rotation therefore changes only the page, never its Annotations' coordinates.
  const turnPages = (pageIndexes: readonly number[], quarterTurns: number): void => {
    const document = currentDocument();
    if (!setPageRotation) throw new Error('Page Rotation editing is unavailable');
    for (const index of pageIndexes) {
      const page = document.pages[index];
      if (!page) throw new Error(`Page ${index + 1} does not exist`);
      const rotation = ((((page.rotation + quarterTurns) % 4) + 4) % 4) as Rotation;
      setPageRotation(document, index, rotation);
      page.rotation = rotation;
    }
    editRevision += 1;
    pageRotationChanged?.(pageIndexes);
    stateChanged();
  };
  let editRevision = 0;
  let savedRevision = 0;
  let retryNativeAnnotations = false;
  const onAnnotationEvent: Parameters<typeof annotationScope.onAnnotationEvent>[0] = (event) => {
    if (
      event.type === 'update' &&
      event.patch.author !== undefined &&
      event.patch.author !== event.annotation.author
    ) {
      annotationScope.syncAnnotationObject(event.annotation.id, {
        author: event.annotation.author,
      });
    }
    if (event.type !== 'loaded' && !event.committed) {
      editRevision += 1;
      stateChanged();
    }
  };
  const editing: NativePdfEditing = {
    state: () => ({
      revision: editRevision,
      dirty: editRevision !== savedRevision,
      readOnlyReason,
    }),
    async exportPdf() {
      if (readOnlyReason) throw new Error(readOnlyReason);
      const revision = editRevision;
      const expected = annotationScope
        .getAnnotations()
        .filter(({ commitState }) => commitState !== 'deleted')
        .map(({ object }) => structuredClone(object));
      const retry = retryNativeAnnotations;
      retryNativeAnnotations = true;
      await annotationScope.commit().toPromise();
      if (retry) {
        // A failed plugin batch may already be labelled synced. Reconcile the
        // current live edits through the public engine API on an explicit retry,
        // without clearing/recreating the UI or its undo history.
        const document = currentDocument();
        for (const page of document.pages) {
          const native = await engine.getPageAnnotations(document, page).toPromise();
          const desired = expected.filter((annotation) => annotation.pageIndex === page.index);
          for (const annotation of native) {
            if (revision !== editRevision) throw new Error('Annotations changed; retry Save');
            if (!desired.some((item) => item.id === annotation.id)) {
              if (!(await engine.removePageAnnotation(document, page, annotation).toPromise()))
                throw new Error('Native annotation deletion failed');
            }
          }
          for (const annotation of desired) {
            if (revision !== editRevision) throw new Error('Annotations changed; retry Save');
            const existing = native.find((item) => item.id === annotation.id);
            if (!existing)
              await engine.createPageAnnotation(document, page, annotation).toPromise();
            else if (!nativeAnnotationMatches(annotation, existing)) {
              if (!(await engine.updatePageAnnotation(document, page, annotation).toPromise()))
                throw new Error('Native annotation update failed');
            }
          }
        }
      }
      // PDFium's standard note appearance generator replaces /Rect with a 20pt
      // icon box. Restore the reader's actual geometry after any generation,
      // using the public update option that leaves the appearance intact. This
      // also preserves deliberate moves and resizes, rather than snapping to the
      // geometry from when the Document was opened.
      const document = currentDocument();
      for (const page of document.pages) {
        const notes = expected.filter(
          (annotation) =>
            annotation.type === PdfAnnotationSubtype.TEXT && annotation.pageIndex === page.index,
        );
        if (notes.length === 0) continue;
        const native = await engine.getPageAnnotations(document, page).toPromise();
        for (const note of notes) {
          if (revision !== editRevision) throw new Error('Annotations changed; retry Save');
          const existing = native.find((annotation) => annotation.id === note.id);
          if (
            existing &&
            !nativeAnnotationMatches(note, existing) &&
            nativeAnnotationMatches({ ...note, rect: existing.rect }, existing)
          ) {
            if (
              !(await engine
                .updatePageAnnotation(document, page, note, { regenerateAppearance: false })
                .toPromise())
            )
              throw new Error('Native note geometry could not be preserved; retry Save');
          }
        }
      }
      for (const [key, pending] of pendingAppearances) {
        if (pending.document.id !== document.id) continue;
        if (expected.some(({ id }) => id === pending.annotationId))
          mapRegeneratedTextMarkupAppearance(engine, { ...pending, document });
        pendingAppearances.delete(key);
      }
      const buffer = await engine.saveAsCopy(document).toPromise();
      // The pinned plugin can resolve commit() despite a failed individual mutation.
      // Reopen exported bytes and check native fields before permitting a disk write.
      const verification = await engine
        // The viewer's own (normalized) geometry, so markup on rotated pages compares exactly.
        .openDocumentBuffer(
          { id: `verify-${crypto.randomUUID()}`, content: buffer },
          { normalizeRotation: true },
        )
        .toPromise();
      try {
        if (
          verification.pages.length !== document.pages.length ||
          verification.pages.some(
            (page, index) => page.rotation !== document.pages[index]?.rotation,
          )
        ) {
          throw new Error('Page Rotation verification failed; unsaved edits were retained');
        }
        const actual = (
          await Promise.all(
            verification.pages.map((page) =>
              engine.getPageAnnotations(verification, page).toPromise(),
            ),
          )
        ).flat();
        if (
          expected.length !== actual.length ||
          expected.some((annotation) => {
            const reopened = actual.find((item) => item.id === annotation.id);
            return !reopened || !nativeAnnotationMatches(annotation, reopened);
          })
        ) {
          throw new Error('Native annotation verification failed; unsaved edits were retained');
        }
      } finally {
        await engine.closeDocument(verification).toPromise();
      }
      const bytes = new Uint8Array(buffer);
      if (revision !== editRevision)
        throw new Error('Annotations changed during export; retry Save');
      retryNativeAnnotations = false;
      return bytes;
    },
    markSaved(revision) {
      savedRevision = revision;
      stateChanged();
    },
    markRecovered(revision) {
      editRevision = Math.max(editRevision, revision);
      savedRevision = 0;
      stateChanged();
    },
    rotatePages(pages: readonly number[], direction: PageRotationDirection) {
      if (readOnlyReason) throw new Error(readOnlyReason);
      const document = currentDocument();
      const pageIndexes = [...new Set(pages)].map((page) => page - 1);
      if (
        pageIndexes.length === 0 ||
        pageIndexes.some((index) => !Number.isInteger(index) || !document.pages[index])
      )
        throw new Error('Choose pages that exist in this Document to rotate');
      if (!setPageRotation) throw new Error('Page Rotation editing is unavailable');
      const turn = direction === 'clockwise' ? 1 : -1;
      const command = {
        execute: () => turnPages(pageIndexes, turn),
        undo: () => turnPages(pageIndexes, -turn),
        metadata: { pageRotation: pageIndexes },
      };
      if (history) history.register(command, 'page-rotation');
      else command.execute();
    },
    editAnnotation(annotationId: string, edit: AnnotationEdit) {
      if (readOnlyReason) throw new Error(readOnlyReason);
      const annotation = annotationScope.getAnnotationById(annotationId);
      if (!annotation || annotation.commitState === 'deleted')
        throw new Error('The Annotation no longer exists');
      const { pageIndex } = annotation.object;
      if (edit.type === 'delete') annotationScope.deleteAnnotation(pageIndex, annotationId);
      else
        annotationScope.updateAnnotation(
          pageIndex,
          annotationId,
          edit.type === 'contents'
            ? { contents: edit.contents }
            : { strokeColor: edit.strokeColor },
        );
    },
    canUndo: () => !readOnlyReason && (history?.canUndo() ?? false),
    canRedo: () => !readOnlyReason && (history?.canRedo() ?? false),
    undo() {
      if (readOnlyReason) throw new Error(readOnlyReason);
      if (!history) throw new Error('Undo is unavailable for this Document');
      history.undo();
    },
    redo() {
      if (readOnlyReason) throw new Error(readOnlyReason);
      if (!history) throw new Error('Redo is unavailable for this Document');
      history.redo();
    },
    setAnnotationDisplayName(displayName) {
      for (const toolId of embedPdfAnnotationToolIds()) {
        annotations.setToolDefaults(toolId, { author: displayName });
      }
    },
  };

  return { editing, onAnnotationEvent };
}
