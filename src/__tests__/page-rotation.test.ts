import { describe, expect, it, vi } from 'vitest';
import type { DocumentContent } from '../reader/document-content';
import type { DocumentRuntime } from '../reader/document-queries';
import type {
  NativePdfEditing,
  NativePdfSaveAdapter,
  PageRotationDirection,
} from '../reader/native-pdf-editing';
import { createReaderActions, readerAction } from '../reader/reader-actions';
import type { RecoveryDraftAdapter } from '../reader/recovery-drafts';

const DOCUMENT = {
  filePath: '/docs/report.pdf',
  title: 'report.pdf',
  readingPosition: { page: 1, location: 0 },
};
const SESSION = {
  schemaVersion: 3 as const,
  activeDocumentPath: DOCUMENT.filePath,
  documents: [DOCUMENT],
};
const SIGNED = 'Digitally signed PDFs are read-only to preserve their signatures';

/**
 * A substitute for the viewer's native editing: Page Rotations live in its PDF, with one
 * undo timeline, and its exported bytes name each page's rotation.
 */
function pdfEditing(pageCount: number, readOnlyReason: string | null = null) {
  let rotations = Array.from({ length: pageCount }, () => 0);
  const done: number[][] = [];
  const undone: number[][] = [];
  let revision = 0;
  let savedRevision = 0;
  const apply = (next: number[]) => {
    rotations = next;
    revision += 1;
  };
  const editing: Required<
    Pick<NativePdfEditing, 'state' | 'exportPdf' | 'markSaved' | 'rotatePages' | 'undo' | 'redo'>
  > = {
    state: () => ({ revision, dirty: revision !== savedRevision, readOnlyReason }),
    exportPdf: vi.fn(async () => new TextEncoder().encode(JSON.stringify(rotations))),
    markSaved: (saved) => {
      savedRevision = saved;
    },
    rotatePages: vi.fn((pages: readonly number[], direction: PageRotationDirection) => {
      if (pages.some((page) => page > pageCount)) throw new Error('No such page');
      done.push(rotations);
      undone.length = 0;
      const turn = direction === 'clockwise' ? 90 : 270;
      apply(
        rotations.map((rotation, index) =>
          pages.includes(index + 1) ? (rotation + turn) % 360 : rotation,
        ),
      );
    }),
    undo: () => {
      const previous = done.pop();
      if (!previous) return;
      undone.push(rotations);
      apply(previous);
    },
    redo: () => {
      const next = undone.pop();
      if (!next) return;
      done.push(rotations);
      apply(next);
    },
  };
  return editing;
}

const rotationsIn = (bytes: Uint8Array | undefined): number[] =>
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
    saveSource: 'source-token',
    recovery: { sourceVersion: 'source-v1' },
    content,
    destroy: vi.fn(async () => undefined),
    renderThumbnail: vi.fn(),
  };
}

async function openReader(
  editing: NativePdfEditing,
  writeOriginal: NativePdfSaveAdapter['writeOriginal'] = async (_token, bytes) => bytes,
) {
  const recoveryDraftAdapter: RecoveryDraftAdapter = {
    inspect: vi.fn(),
    write: vi.fn(async () => undefined),
    reconcile: vi.fn(async () => ({ sourceVersion: 'source-v2' })),
    remove: vi.fn(async () => undefined),
    repairAfterWrite: vi.fn(async () => ({ sourceVersion: 'source-v2' })),
  };
  const pdfSaveAdapter: NativePdfSaveAdapter = {
    writeOriginal: vi.fn(writeOriginal),
    chooseDestination: async () => null,
    writeDestination: vi.fn(),
    releaseDestination: async () => undefined,
  };
  const reader = createReaderActions({
    initialSession: SESSION,
    projection: {
      activateDocument: async () => undefined,
      goToReadingPosition: async () => undefined,
      verifySavedDocument: async () => undefined,
    },
    pdfSaveAdapter,
    recoveryDraftAdapter,
    persist: async () => undefined,
  });
  await reader.dispatch({
    type: 'registerDocument',
    document: DOCUMENT,
    runtime: runtimeWith(editing),
  });
  return { reader, recoveryDraftAdapter, pdfSaveAdapter };
}

describe('Page Rotation Reader Action', () => {
  it('is an unsaved, undoable Document edit captured in Recovery Drafts and saved into the PDF', async () => {
    const editing = pdfEditing(3);
    const { reader, recoveryDraftAdapter, pdfSaveAdapter } = await openReader(editing);

    await expect(
      reader.dispatch(readerAction.rotatePages([1, 3], 'clockwise')),
    ).resolves.toMatchObject({ status: 'performed' });
    expect(reader.hasUnsavedPdfWork()).toBe(true);

    await expect(reader.captureRecoveryDraft(DOCUMENT.filePath)).resolves.toMatchObject({
      status: 'performed',
    });
    const draft = vi.mocked(recoveryDraftAdapter.write).mock.lastCall?.[0];
    expect(draft).toMatchObject({ documentPath: DOCUMENT.filePath, sourceVersion: 'source-v1' });
    expect(rotationsIn(draft?.bytes)).toEqual([90, 0, 90]);

    await expect(reader.dispatch({ type: 'undoEdit' })).resolves.toMatchObject({
      status: 'performed',
    });
    expect(rotationsIn(await editing.exportPdf())).toEqual([0, 0, 0]);
    await expect(reader.dispatch({ type: 'redoEdit' })).resolves.toMatchObject({
      status: 'performed',
    });
    await reader.dispatch(readerAction.rotatePages([3], 'counterclockwise'));

    await expect(reader.dispatch({ type: 'saveDocument' })).resolves.toMatchObject({
      status: 'performed',
    });
    const written = vi.mocked(
      pdfSaveAdapter.writeOriginal as NonNullable<NativePdfSaveAdapter['writeOriginal']>,
    ).mock.lastCall;
    expect(written?.[0]).toBe('source-token');
    expect(rotationsIn(written?.[1])).toEqual([90, 0, 0]);
    expect(reader.hasUnsavedPdfWork()).toBe(false);
  });

  it('is refused with the existing explanation when editing is unavailable', async () => {
    const signed = pdfEditing(3, SIGNED);
    const { reader } = await openReader(signed);

    const outcome = await reader.dispatch(readerAction.rotatePages([1], 'clockwise'));

    expect(outcome).toMatchObject({ status: 'failure', error: new Error(SIGNED) });
    expect(signed.rotatePages).not.toHaveBeenCalled();
    expect(reader.hasUnsavedPdfWork()).toBe(false);
    await expect(reader.dispatch({ type: 'undoEdit' })).resolves.toMatchObject({
      status: 'failure',
      error: new Error(SIGNED),
    });
  });

  it('keeps the rotation unsaved when external-conflict detection blocks the overwrite', async () => {
    const editing = pdfEditing(3);
    const { reader } = await openReader(editing, async () => {
      throw new Error('File conflict: destination changed, was replaced, or disappeared.');
    });
    await reader.dispatch(readerAction.rotatePages([2], 'clockwise'));

    const outcome = await reader.dispatch({ type: 'saveDocument' });

    expect(outcome).toMatchObject({ status: 'failure' });
    expect(String((outcome as { error: unknown }).error)).toContain('File conflict');
    expect(reader.hasUnsavedPdfWork()).toBe(true);
    expect(rotationsIn(await editing.exportPdf())).toEqual([0, 90, 0]);
  });

  it.each([
    [[] as number[]],
    [[0]],
    [[1.5]],
  ])('ignores the page set %j and reports pages the Document lacks', async (pages) => {
    const editing = pdfEditing(3);
    const { reader } = await openReader(editing);

    await expect(
      reader.dispatch(readerAction.rotatePages(pages, 'clockwise')),
    ).resolves.toMatchObject({
      status: 'no-op',
    });
    expect(editing.rotatePages).not.toHaveBeenCalled();
    await expect(
      reader.dispatch(readerAction.rotatePages([4], 'clockwise')),
    ).resolves.toMatchObject({
      status: 'failure',
    });
    expect(reader.hasUnsavedPdfWork()).toBe(false);
  });
});
