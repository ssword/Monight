import type { PdfDocumentObject, PdfEngine } from '@embedpdf/models';
import {
  type AnnotationCapability,
  PdfAnnotationSubtype,
  type TrackedAnnotation,
} from '@embedpdf/snippet';
import type { NativePdfEditing } from '../reader/native-pdf-editing';
import { embedPdfAnnotationToolIds } from './embedpdf-offline-configuration';

/** Compare the supported editable fields, tolerating PDF float serialization only. */
function nativeAnnotationMatches(
  expected: TrackedAnnotation['object'],
  actual: TrackedAnnotation['object'],
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
  const fields = [
    'id',
    'type',
    'pageIndex',
    'rect',
    'contents',
    'author',
    'strokeColor',
    'opacity',
    'segmentRects',
  ] as const;
  return fields.every((field) => {
    const value = Reflect.get(expected, field);
    const saved = Reflect.get(actual, field);
    if (value === undefined) return true;
    if (field === 'strokeColor' && typeof value === 'string' && typeof saved === 'string')
      return value.toLowerCase() === saved.toLowerCase();
    // PDFium represents alpha in 8 bits and standard note icons as 20pt squares
    // anchored at the lower-left PDF point, independent of the UI's 24pt hit box.
    if (field === 'opacity' && typeof value === 'number' && typeof saved === 'number')
      return Math.round(value * 255) === Math.round(saved * 255);
    if (field === 'rect' && expected.type === PdfAnnotationSubtype.TEXT) {
      return equal(
        {
          origin: {
            x: expected.rect.origin.x,
            y: expected.rect.origin.y + expected.rect.size.height - 20,
          },
          size: { width: 20, height: 20 },
        },
        saved,
      );
    }
    return equal(value, saved);
  });
}

export function createEmbedPdfNativeAnnotationEditing({
  annotations,
  annotationScope,
  currentDocument,
  engine,
  readOnlyReason,
  stateChanged,
}: {
  annotations: AnnotationCapability;
  annotationScope: ReturnType<AnnotationCapability['forDocument']>;
  currentDocument: () => PdfDocumentObject;
  engine: PdfEngine;
  readOnlyReason: string | null;
  stateChanged: () => void;
}) {
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
      const buffer = await engine.saveAsCopy(currentDocument()).toPromise();
      // The pinned plugin can resolve commit() despite a failed individual mutation.
      // Reopen exported bytes and check native fields before permitting a disk write.
      const verification = await engine
        .openDocumentBuffer({ id: `verify-${crypto.randomUUID()}`, content: buffer })
        .toPromise();
      try {
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
    setAnnotationDisplayName(displayName) {
      for (const toolId of embedPdfAnnotationToolIds()) {
        annotations.setToolDefaults(toolId, { author: displayName });
      }
    },
  };

  return { editing, onAnnotationEvent };
}
