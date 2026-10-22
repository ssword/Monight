import type { PdfAnnotationObject, PdfDocumentObject, PdfEngine } from '@embedpdf/models';
import {
  type AnnotationPlugin,
  type DocumentManagerPlugin,
  type EmbedPdfContainer,
  LockModeType,
  PdfAnnotationSubtype,
  type SelectionPlugin,
} from '@embedpdf/snippet';
import { navigationPdf } from './__fixtures__/navigation-pdf';
import { createEmbedPdfDocumentSurfaceFactory } from './app/embedpdf-document-surface';

const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

async function open(bytes: Uint8Array) {
  const surface = await createEmbedPdfDocumentSurfaceFactory({ assessEditing: async () => null })({
    filePath: '/text-markup-regression.pdf',
    title: 'text-markup-regression.pdf',
    bytes,
    callbacks: {
      readingPositionObserved() {},
      readingPositionSettled() {},
      stateChanged() {},
      pageNavigationRequested: async () => undefined,
      zoomIntentRequested: async () => undefined,
    },
  });
  surface.rendering.setVisible(true);
  const container = document.querySelector<EmbedPdfContainer>('embedpdf-container');
  if (!container) throw new Error('Missing viewer');
  const registry = await container.registry;
  const annotations = registry.getPlugin<AnnotationPlugin>('annotation')?.provides();
  const manager = registry.getPlugin<DocumentManagerPlugin>('document-manager')?.provides();
  const selection = registry.getPlugin<SelectionPlugin>('selection')?.provides();
  const doc = manager?.getActiveDocument();
  const editing = surface.runtime.editing;
  if (!annotations || !selection || !doc || !editing)
    throw new Error('Missing editing capabilities');
  // Verification harness only; the production verified-tool list stays unchanged.
  annotations.setLocked({ type: LockModeType.None });
  return { surface, annotations, selection, doc, editing, engine: registry.getEngine() };
}

async function pixels(engine: PdfEngine, doc: PdfDocumentObject, object: PdfAnnotationObject) {
  const rendered = await engine
    .renderPageAnnotationsRaw(doc, doc.pages[object.pageIndex], { scaleFactor: 4 })
    .toPromise();
  const image = rendered[object.id]?.normal?.data;
  if (!image) throw new Error('Missing native appearance pixels');
  return image;
}

async function checkReopenedAppearance(view: Awaited<ReturnType<typeof open>>, bytes: Uint8Array) {
  const doc = await view.engine
    .openDocumentBuffer(
      { id: crypto.randomUUID(), content: bytes.slice().buffer },
      { normalizeRotation: true },
    )
    .toPromise();
  try {
    const objects = await view.engine.getPageAnnotations(doc, doc.pages[0]).toPromise();
    for (const object of objects) {
      if (
        object.type !== PdfAnnotationSubtype.UNDERLINE &&
        object.type !== PdfAnnotationSubtype.STRIKEOUT
      )
        continue;
      const image = await pixels(view.engine, doc, object);
      let left = image.width,
        right = -1;
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          if (image.data[(y * image.width + x) * 4 + 3] > 50) {
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
      const expectedWidth = object.segmentRects[0].size.width;
      check(
        Math.abs((right - left + 1) / 4 - expectedWidth) < 1,
        `Regenerated ${object.type} stretched beyond its QuadPoints`,
      );
    }
  } finally {
    await view.engine.closeDocument(doc).toPromise();
  }
}

async function run() {
  const fixture = new URL(
    '../src-tauri/tests/fixtures/text-markup-verification/acrobat-text-markups.pdf',
    import.meta.url,
  );
  const input = new Uint8Array(await (await fetch(fixture)).arrayBuffer());
  let view = await open(input);
  const marks = view.annotations
    .getAnnotations()
    .filter(
      ({ object }) =>
        object.type === PdfAnnotationSubtype.UNDERLINE ||
        object.type === PdfAnnotationSubtype.STRIKEOUT,
    );
  check(marks.length === 2, 'Both native Acrobat markups must be present');
  const originalPixels = await Promise.all(
    marks.map(({ object }) => pixels(view.engine, view.doc, object)),
  );
  for (const { object } of marks)
    view.annotations.updateAnnotation(object.pageIndex, object.id, {
      contents: `Contents only ${object.type}`,
    });
  const contents = await view.editing.exportPdf();
  const reopened = await view.engine
    .openDocumentBuffer(
      { id: crypto.randomUUID(), content: contents.slice().buffer },
      { normalizeRotation: true },
    )
    .toPromise();
  const reopenedMarks = await view.engine
    .getPageAnnotations(reopened, reopened.pages[0])
    .toPromise();
  for (const [index, { object }] of marks.entries()) {
    const saved = reopenedMarks.find((a) => a.id === object.id);
    if (!saved) throw new Error('Edited native markup disappeared');
    const image = await pixels(view.engine, reopened, saved);
    const original = originalPixels[index];
    check(
      image.width === original.width &&
        image.height === original.height &&
        image.data.every((v, i) => v === original.data[i]),
      `Contents-only ${object.type} changed native appearance pixels`,
    );
  }
  await view.engine.closeDocument(reopened).toPromise();
  for (const { object } of marks)
    view.annotations.updateAnnotation(object.pageIndex, object.id, {
      strokeColor: '#228833',
      opacity: 0.5,
    });
  const pdfium = Reflect.get(Reflect.get(view.engine, 'executor'), 'pdfiumModule');
  const setAP = pdfium.FPDFAnnot_SetAP;
  pdfium.FPDFAnnot_SetAP = () => false;
  let blocked = false;
  try {
    await view.editing.exportPdf();
  } catch {
    blocked = true;
  } finally {
    pdfium.FPDFAnnot_SetAP = setAP;
  }
  check(blocked, 'Save ignored a failed native appearance correction');
  const colour = await view.editing.exportPdf();
  await checkReopenedAppearance(view, colour);
  for (const { object } of view.annotations
    .getAnnotations()
    .filter(({ object }) => marks.some((m) => m.object.id === object.id))) {
    if (!('segmentRects' in object)) throw new Error('Missing segments');
    view.annotations.updateAnnotation(object.pageIndex, object.id, {
      rect: {
        ...object.rect,
        origin: { x: object.rect.origin.x + 10, y: object.rect.origin.y + 20 },
      },
      segmentRects: object.segmentRects.map((r) => ({
        ...r,
        origin: { x: r.origin.x + 10, y: r.origin.y + 20 },
      })),
    });
  }
  const moved = await view.editing.exportPdf();
  await checkReopenedAppearance(view, moved);
  for (const { object } of marks)
    view.annotations.updateAnnotation(object.pageIndex, object.id, {
      opacity: 1,
      strokeColor: '#883322',
    });
  const opaque = await view.editing.exportPdf();
  await checkReopenedAppearance(view, opaque);
  await view.surface.runtime.destroy();

  view = await open(navigationPdf('Selection geometry regression', 0, false));
  await view.selection
    .setSelection({ start: { page: 2, index: 0 }, end: { page: 2, index: 2 } })
    .toPromise();
  const selected = view.selection.getFormattedSelection();
  check(
    selected[0]?.segmentRects[0].size.height < 30,
    'Selection still uses oversized loose font bounds',
  );
  check(
    view.surface.rendering.markupSelection?.('underline', { strokeColor: '#1122cc' }),
    'Immediate markup failed',
  );
  // Wait for the actual selection text/annotation creation task, not a supplied rectangle.
  const deadline = performance.now() + 10000;
  while (
    !view.annotations
      .getAnnotations()
      .some(({ object }) => object.type === PdfAnnotationSubtype.UNDERLINE)
  ) {
    if (performance.now() > deadline) throw new Error('Selection markup creation timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const selection = await view.editing.exportPdf();
  await view.surface.runtime.destroy();
  const fontsInput = new Uint8Array(
    await (
      await fetch(
        new URL(
          '../src-tauri/tests/fixtures/text-markup-verification/selection-fonts.pdf',
          import.meta.url,
        ),
      )
    ).arrayBuffer(),
  );
  view = await open(fontsInput);
  const geometry = await view.engine.getPageGeometry(view.doc, view.doc.pages[0]).toPromise();
  const text = await view.engine
    .getTextSlices(view.doc, [{ pageIndex: 0, charIndex: 0, charCount: 200 }])
    .toPromise();
  // A real multiline selection across three fonts/sizes, not hand-built rects.
  const last = geometry.runs[geometry.runs.length - 1];
  if (!last) throw new Error('Missing font geometry');
  await view.selection
    .setSelection({
      start: { page: 0, index: 0 },
      end: { page: 0, index: last.charStart + last.glyphs.length - 1 },
    })
    .toPromise();
  const multiline = view.selection.getFormattedSelection()[0];
  check(
    multiline.segmentRects.length === 3,
    `Multiline font selection merged lines: ${JSON.stringify(multiline)}`,
  );
  check(
    view.surface.rendering.markupSelection?.('underline', { strokeColor: '#1122cc' }),
    'Multiline Underline failed',
  );
  const waitUntil = performance.now() + 10000;
  while (
    !view.annotations
      .getAnnotations()
      .some(({ object }) => object.type === PdfAnnotationSubtype.UNDERLINE)
  ) {
    if (performance.now() > waitUntil) throw new Error('Multiline markup timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const fonts = await view.editing.exportPdf();
  await view.surface.runtime.destroy();
  view = await open(fontsInput);
  Reflect.set(window, 'textMarkupActive', {
    start(tool: string) {
      view.annotations.deselectAnnotation();
      view.annotations.setActiveTool(tool);
    },
    count() {
      return view.annotations.getAnnotations().length;
    },
    async finish() {
      return [...(await view.editing.exportPdf())];
    },
    objects() {
      return view.annotations.getAnnotations().map(({ object }) => object);
    },
  });
  return {
    fonts: [...fonts],
    multiline,
    text,
    contents: [...contents],
    colour: [...colour],
    moved: [...moved],
    opaque: [...opaque],
    selection: [...selection],
    selected,
  };
}

run()
  .then((result) => {
    Reflect.set(window, 'textMarkupSmoke', result);
    document.body.dataset.status = 'ready';
  })
  .catch((error) => {
    console.error(error);
    document.body.dataset.error = String(error);
    document.body.dataset.status = 'error';
  });
