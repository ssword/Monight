import { describe, expect, it, vi } from 'vitest';
import type { DocumentContent } from '../reader/document-content';
import type { DocumentRuntime } from '../reader/document-queries';
import type {
  AnnotationEdit,
  NativePdfEditing,
  NativePdfSaveAdapter,
} from '../reader/native-pdf-editing';
import { createReaderActions, type ReaderActions, readerAction } from '../reader/reader-actions';

const REPORT = {
  filePath: '/docs/report.pdf',
  title: 'report.pdf',
  readingPosition: { page: 1, location: 0 },
};
const NOTES = {
  filePath: '/docs/notes.pdf',
  title: 'notes.pdf',
  readingPosition: { page: 1, location: 0 },
};
const SIGNED = 'Digitally signed PDFs are read-only to preserve their signatures';

/** A substitute for the viewer's native editing: Annotation notes live in its PDF. */
function pdfEditing(notes: Record<string, string>, readOnlyReason: string | null = null) {
  const annotations = new Map(Object.entries(notes));
  let revision = 0;
  let savedRevision = 0;
  const editing: Required<
    Pick<NativePdfEditing, 'state' | 'exportPdf' | 'markSaved' | 'editAnnotation'>
  > = {
    state: () => ({ revision, dirty: revision !== savedRevision, readOnlyReason }),
    exportPdf: vi.fn(async () =>
      new TextEncoder().encode(JSON.stringify(Object.fromEntries(annotations))),
    ),
    markSaved: (saved) => {
      savedRevision = saved;
    },
    editAnnotation: vi.fn((annotationId: string, edit: AnnotationEdit) => {
      if (!annotations.has(annotationId)) throw new Error('No such Annotation');
      if (edit.type === 'delete') annotations.delete(annotationId);
      else if (edit.type === 'contents') annotations.set(annotationId, edit.contents);
      revision += 1;
    }),
  };
  return editing;
}

const notesIn = (bytes: Uint8Array | undefined): Record<string, string> =>
  JSON.parse(new TextDecoder().decode(bytes));

function runtimeWith(editing: NativePdfEditing): DocumentRuntime {
  const content: DocumentContent = {
    pageCount: 3,
    getPage: vi.fn(),
    getData: vi.fn(async () => new Uint8Array()),
    search: vi.fn(async () => []),
    getOutline: vi.fn(async () => []),
    getMetadata: vi.fn(async () => null),
    resolveLinkTarget: vi.fn(async () => null),
    destroy: vi.fn(async () => undefined),
  };
  return {
    editing,
    saveSource: `source:${Math.random()}`,
    content,
    destroy: vi.fn(async () => undefined),
    renderThumbnail: vi.fn(),
  };
}

async function openReader(
  documents: ReadonlyArray<{ document: typeof REPORT; editing: NativePdfEditing }>,
) {
  const pdfSaveAdapter: NativePdfSaveAdapter = {
    writeOriginal: vi.fn(async (_token: string, bytes: Uint8Array) => bytes),
    chooseDestination: async () => null,
    writeDestination: vi.fn(),
    releaseDestination: async () => undefined,
  };
  const chooseUnsavedDocument = vi.fn(async () => 'cancel' as const);
  const reader: ReaderActions = createReaderActions({
    initialSession: {
      schemaVersion: 3,
      activeDocumentPath: documents[0]?.document.filePath ?? null,
      documents: documents.map(({ document }) => document),
    },
    projection: {
      activateDocument: async () => undefined,
      goToReadingPosition: async () => undefined,
      verifySavedDocument: async () => undefined,
      closeDocument: async () => undefined,
    },
    pdfSaveAdapter,
    chooseUnsavedDocument,
    persist: async () => undefined,
  });
  for (const { document, editing } of documents) {
    await reader.dispatch({
      type: 'registerDocument',
      document,
      runtime: runtimeWith(editing),
      activate: document === documents[0]?.document,
    });
  }
  return { reader, pdfSaveAdapter, chooseUnsavedDocument };
}

describe('Annotation edit Reader Action', () => {
  it('edits the Annotation of the Document it names, not the active one', async () => {
    const report = pdfEditing({ 'note-1': '' });
    const notes = pdfEditing({ 'note-1': '' });
    const { reader } = await openReader([
      { document: REPORT, editing: report },
      { document: NOTES, editing: notes },
    ]);
    await reader.dispatch({ type: 'activateDocument', filePath: NOTES.filePath });

    const outcome = await reader.dispatch(
      readerAction.editAnnotation(REPORT.filePath, 'note-1', {
        type: 'contents',
        contents: 'Ask about the moon',
      }),
    );

    expect(outcome).toMatchObject({ status: 'performed' });
    expect(notesIn(await report.exportPdf())).toEqual({ 'note-1': 'Ask about the moon' });
    expect(notes.editAnnotation).not.toHaveBeenCalled();
    expect(reader.hasUnsavedPdfWork()).toBe(true);
  });

  it('is refused with the existing explanation on a protected Document', async () => {
    const signed = pdfEditing({ 'mark-1': 'Remember this' }, SIGNED);
    const { reader } = await openReader([{ document: REPORT, editing: signed }]);

    const outcome = await reader.dispatch(
      readerAction.editAnnotation(REPORT.filePath, 'mark-1', { type: 'delete' }),
    );

    expect(outcome).toMatchObject({ status: 'failure', error: new Error(SIGNED) });
    expect(signed.editAnnotation).not.toHaveBeenCalled();
    expect(reader.hasUnsavedPdfWork()).toBe(false);
  });
});
