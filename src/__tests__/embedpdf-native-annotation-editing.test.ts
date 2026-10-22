import {
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfEngine,
  type PdfPageObject,
  Task,
} from '@embedpdf/models';
import { PdfAnnotationSubtype } from '@embedpdf/snippet';
import { describe, expect, it, vi } from 'vitest';
import { createEmbedPdfNativeAnnotationEditing } from '../app/embedpdf-native-annotation-editing';

const DOCUMENT = { id: 'document' } as PdfDocumentObject;
const PAGE = { index: 0 } as PdfPageObject;

const resolved = <T>(value: T) => {
  const task = new Task<T, never>();
  task.resolve(value);
  return task;
};

const highlight = (overrides: Partial<PdfAnnotationObject> = {}) =>
  ({
    type: PdfAnnotationSubtype.HIGHLIGHT,
    id: 'highlight',
    pageIndex: 0,
    rect: { origin: { x: 72, y: 50 }, size: { width: 160, height: 24 } },
    segmentRects: [{ origin: { x: 72, y: 50 }, size: { width: 160, height: 24 } }],
    strokeColor: '#FFCD45',
    opacity: 1,
    contents: 'Before',
    ...overrides,
  }) as PdfAnnotationObject;

/**
 * The engine's native update after the adapter wraps it, for a page holding
 * `native`. The engine has no direct executor, so any appearance mapping fails.
 */
function wrappedUpdate(native: PdfAnnotationObject) {
  const update = vi.fn(() => resolved(true));
  const engine = {
    getPageAnnotations: () => resolved([native]),
    updatePageAnnotation: update,
  } as unknown as PdfEngine;
  createEmbedPdfNativeAnnotationEditing({
    annotations: {} as never,
    annotationScope: {} as never,
    currentDocument: () => DOCUMENT,
    engine,
    readOnlyReason: null,
    stateChanged: () => {},
  });
  const edit = (annotation: PdfAnnotationObject) =>
    engine.updatePageAnnotation(DOCUMENT, PAGE, annotation).toPromise();
  return { edit, update };
}

describe('EmbedPDF native Highlight appearance preservation (#127)', () => {
  it('keeps the native appearance when only the comment changes, despite 8-bit colour readback', async () => {
    const { edit, update } = wrappedUpdate(highlight({ strokeColor: '#FFCD44' }));

    await expect(edit(highlight({ contents: 'After' }))).resolves.toBe(true);

    expect(update).toHaveBeenCalledWith(
      DOCUMENT,
      PAGE,
      expect.objectContaining({ contents: 'After' }),
      expect.objectContaining({ regenerateAppearance: false }),
    );
  });

  it.each([
    ['colour', { strokeColor: '#6CB4F5' }],
    ['opacity', { opacity: 0.5 }],
  ] as const)('regenerates the engine appearance, without Underline/StrikeOut mapping, on a %s edit', async (_field, change) => {
    const { edit, update } = wrappedUpdate(highlight());

    await expect(edit(highlight(change))).resolves.toBe(true);

    expect(update).toHaveBeenCalledWith(
      DOCUMENT,
      PAGE,
      expect.anything(),
      expect.objectContaining({ regenerateAppearance: true }),
    );
  });

  it('treats a colour more than one 8-bit step away as a visual edit', async () => {
    const { edit, update } = wrappedUpdate(highlight({ strokeColor: '#FFCD43' }));

    await edit(highlight({ contents: 'After' }));

    expect(update).toHaveBeenCalledWith(
      DOCUMENT,
      PAGE,
      expect.anything(),
      expect.objectContaining({ regenerateAppearance: true }),
    );
  });
});
