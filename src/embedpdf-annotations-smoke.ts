import { PdfErrorCode, PdfTaskHelper } from '@embedpdf/models';
import type {
  AnnotationCapability,
  DocumentManagerCapability,
  EmbedPdfContainer,
  HistoryCapability,
} from '@embedpdf/snippet';
import { PdfAnnotationSubtype } from '@embedpdf/snippet';
import { navigationPdf } from './__fixtures__/navigation-pdf';
import type { DocumentSurface } from './app/document-workspace';
import { createEmbedPdfDocumentSurfaceFactory } from './app/embedpdf-document-surface';
import { normalizeAnnotationDisplayName } from './reader/native-pdf-editing';

declare global {
  interface Window {
    nativeAnnotationSmoke?: {
      original: number[];
      annotated: number[];
      deleted: number[];
      rotated: number[];
      annotations: unknown[];
    };
  }
}
const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

const protectedFixtures = [
  {
    name: 'permission-restricted.pdf',
    url: new URL(
      '../src-tauri/tests/fixtures/protected-documents/permission-restricted.pdf',
      import.meta.url,
    ),
    reason: 'PDF permissions prohibit annotation editing; this Document is read-only',
  },
  {
    name: 'digitally-signed.pdf',
    url: new URL(
      '../src-tauri/tests/fixtures/protected-documents/digitally-signed.pdf',
      import.meta.url,
    ),
    reason: 'Digitally signed PDFs are read-only to preserve their signatures',
  },
  {
    name: 'password-encrypted.pdf',
    url: new URL(
      '../src-tauri/tests/fixtures/protected-documents/password-encrypted.pdf',
      import.meta.url,
    ),
    reason:
      'Encrypted PDFs are read-only because Save, Save As, and Recovery Drafts cannot preserve their protection',
    password: 'monight-test-password',
  },
] as const;

async function verifyProtectedDocuments(): Promise<void> {
  for (const fixture of protectedFixtures) {
    const response = await fetch(fixture.url);
    check(response.ok, `Protected fixture could not be loaded: ${fixture.name}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let passwordRequests = 0;
    const surface = await createEmbedPdfDocumentSurfaceFactory({
      assessEditing: async () => fixture.reason,
      requestPassword: async () => {
        passwordRequests += 1;
        return 'password' in fixture ? fixture.password : null;
      },
    })({
      filePath: `/protected/${fixture.name}`,
      title: fixture.name,
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
    check(surface.runtime.editing?.state().readOnlyReason === fixture.reason, 'Missing reason');
    check(!surface.runtime.editing?.state().dirty, 'Protected Document became dirty');
    check(
      document.querySelector('[role="status"]')?.textContent === fixture.reason,
      'Protected Document explanation is not visible',
    );
    const printBytes = await surface.runtime.preparePrintDocument?.();
    check(
      printBytes && printBytes.length > 0,
      `Printable protected Document failed: ${fixture.name}`,
    );
    check(!surface.runtime.editing?.state().dirty, 'Printing made a protected Document dirty');
    surface.rendering.setActiveAnnotationTool?.('textComment');
    check(
      surface.rendering.activeAnnotationTool?.() === null,
      'Protected Document accepted a markup tool',
    );
    const container = document.querySelector<EmbedPdfContainer>('embedpdf-container');
    if (!container) throw new Error('Missing protected viewer');
    const registry = await container.registry;
    const commands = registry
      .getPlugin<import('@embedpdf/snippet').CommandsPlugin>('commands')
      ?.provides();
    if (!commands) throw new Error('Missing protected viewer commands');
    for (const id of [
      'annotation:add-highlight',
      'annotation:add-comment',
      'document:export',
      'document:protect',
      'annotation:add-stamp',
    ]) {
      let command: ReturnType<typeof commands.resolve>;
      try {
        command = commands.resolve(id);
      } catch {
        continue;
      }
      check(
        !command.visible || command.disabled,
        `Protected Document exposed an unsafe command: ${id}`,
      );
    }
    let exportRejected = false;
    try {
      await surface.runtime.editing?.exportPdf();
    } catch {
      exportRejected = true;
    }
    check(exportRejected, 'Protected Document export was allowed');
    check(
      passwordRequests === ('password' in fixture ? 1 : 0),
      `Unexpected password flow for ${fixture.name}`,
    );
    await surface.runtime.destroy();
  }
  const storedValues = [localStorage, sessionStorage]
    .flatMap((storage) =>
      Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index);
        return key ? `${key}:${storage.getItem(key)}` : '';
      }),
    )
    .join('\n');
  check(
    !storedValues.includes('monight-test-password'),
    'Document password entered browser storage',
  );
  check(
    !document.documentElement.textContent?.includes('monight-test-password'),
    'Document password entered visible diagnostics',
  );
}

async function open(
  bytes: Uint8Array,
  readOnlyReason: string | null = null,
): Promise<{
  surface: DocumentSurface;
  annotations: AnnotationCapability;
  history: HistoryCapability;
  engine: import('@embedpdf/models').PdfEngine;
  registry: import('@embedpdf/snippet').PluginRegistry;
}> {
  const surface = await createEmbedPdfDocumentSurfaceFactory({
    assessEditing: async () => readOnlyReason,
  })({
    filePath: '/fixture.pdf',
    title: 'fixture.pdf',
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
  const annotations = registry
    .getPlugin<import('@embedpdf/snippet').AnnotationPlugin>('annotation')
    ?.provides();
  const history = registry
    .getPlugin<import('@embedpdf/snippet').HistoryPlugin>('history')
    ?.provides();
  const manager: DocumentManagerCapability | undefined = registry
    .getPlugin<import('@embedpdf/snippet').DocumentManagerPlugin>('document-manager')
    ?.provides();
  if (!annotations || !history || !manager?.getActiveDocumentId())
    throw new Error('Missing native annotation capabilities');
  const commands = registry
    .getPlugin<import('@embedpdf/snippet').CommandsPlugin>('commands')
    ?.provides();
  if (!commands) throw new Error('Missing viewer commands');
  for (const id of readOnlyReason === null
    ? ['annotation:add-highlight', 'annotation:add-comment', 'panel:toggle-comment']
    : []) {
    const command = commands.resolve(id);
    check(command.visible && !command.disabled, `Required native UI command is unavailable: ${id}`);
  }
  for (const id of [
    'rotate:clockwise',
    'rotate:counter-clockwise',
    'document:export',
    'document:protect',
    'form:add-textfield',
    'annotation:add-ink',
    'annotation:apply-redaction',
  ]) {
    const command = commands.resolve(id);
    check(!command.visible || command.disabled, `Unsafe viewer command is available: ${id}`);
  }
  verifyReadyMadeAnnotationToolbarUnreachable(registry, manager.getActiveDocumentId() ?? '');
  if (readOnlyReason === null) {
    surface.rendering.setActiveAnnotationTool?.('textComment');
    check(
      annotations.getActiveTool()?.id === 'textComment' &&
        surface.rendering.activeAnnotationTool?.() === 'textComment',
      'Markup toolbar could not choose the Text note tool',
    );
    verifyReadyMadeAnnotationToolbarUnreachable(registry, manager.getActiveDocumentId() ?? '');
    surface.rendering.setActiveAnnotationTool?.(null);
    check(annotations.getActiveTool() === null, 'Text selection was not restored');
  }
  return { surface, annotations, history, engine: registry.getEngine(), registry };
}

/** Monight's markup toolbar replaces the ready-made Annotate mode; no ready-made toolbar exists. */
function verifyReadyMadeAnnotationToolbarUnreachable(
  registry: import('@embedpdf/snippet').PluginRegistry,
  documentId: string,
): void {
  const commands = registry
    .getPlugin<import('@embedpdf/snippet').CommandsPlugin>('commands')
    ?.provides();
  const ui = registry.getPlugin<import('@embedpdf/snippet').UIPlugin>('ui')?.provides();
  if (!commands || !ui) throw new Error('Missing viewer commands or UI plugin');
  const annotate = commands.resolve('mode:annotate');
  check(!annotate.visible || annotate.disabled, 'Ready-made Annotate mode is reachable');
  const schema = ui.forDocument(documentId).getSchema();
  check(
    Object.keys(schema.toolbars).length === 0 && Object.keys(schema.selectionMenus).length === 0,
    'A ready-made toolbar or selection menu is reachable',
  );
}

async function printedPageRotations(
  engine: import('@embedpdf/models').PdfEngine,
  bytes: Uint8Array,
): Promise<number[]> {
  const printedDocument = await engine
    .openDocumentBuffer({
      id: `verify-printed-rotation-${crypto.randomUUID()}`,
      content: bytes.slice().buffer as ArrayBuffer,
    })
    .toPromise();
  try {
    return printedDocument.pages.map(({ rotation }) => rotation * 90);
  } finally {
    await engine.closeDocument(printedDocument).toPromise();
  }
}

type Rect = { origin: { x: number; y: number }; size: { width: number; height: number } };
const sameRect = (a: Rect | undefined, b: Rect) =>
  Boolean(a) &&
  [
    [a?.origin.x, b.origin.x],
    [a?.origin.y, b.origin.y],
    [a?.size.width, b.size.width],
    [a?.size.height, b.size.height],
  ].every(([actual, expected]) => Math.abs((actual ?? Number.NaN) - (expected ?? 0)) < 0.01);

async function reopened(
  engine: import('@embedpdf/models').PdfEngine,
  bytes: Uint8Array,
): Promise<{ rotations: number[]; annotations: import('@embedpdf/models').PdfAnnotationObject[] }> {
  const document = await engine
    .openDocumentBuffer(
      {
        id: `verify-page-rotation-${crypto.randomUUID()}`,
        content: bytes.slice().buffer as ArrayBuffer,
      },
      { normalizeRotation: true },
    )
    .toPromise();
  try {
    const annotations = (
      await Promise.all(
        document.pages.map((page) => engine.getPageAnnotations(document, page).toPromise()),
      )
    ).flat();
    return { rotations: document.pages.map(({ rotation }) => rotation * 90), annotations };
  } finally {
    await engine.closeDocument(document).toPromise();
  }
}

// The viewer places markup in unrotated page space (top-left origin), so a Page Rotation
// never moves markup off its text. Link /Rect [72 650 260 685] on a 612x792 page:
const LINK_RECT = { origin: { x: 72, y: 107 }, size: { width: 188, height: 35 } };
const HIGHLIGHT_RECT = { origin: { x: 72, y: 50 }, size: { width: 160, height: 24 } };

/** Page Rotation is a native Document edit, and markup stays on its text across turns. */
async function verifyPageRotationEdits(): Promise<Uint8Array> {
  // Existing links and new highlights on an already rotated page save and reopen in place.
  let { surface, annotations, engine, history, registry } = await open(
    navigationPdf('Rotated with links', 90),
  );
  const links = annotations
    .getAnnotations()
    .filter(({ object }) => object.type === PdfAnnotationSubtype.LINK && object.pageIndex === 0);
  check(
    links.some(({ object }) => sameRect(object.rect, LINK_RECT)),
    `Existing link on a rotated page is misplaced: ${JSON.stringify(links.map(({ object }) => object.rect))}`,
  );
  annotations.createAnnotation(0, {
    id: 'rotated-page-highlight',
    type: PdfAnnotationSubtype.HIGHLIGHT,
    pageIndex: 0,
    rect: HIGHLIGHT_RECT,
    segmentRects: [HIGHLIGHT_RECT],
    strokeColor: '#FFFF00',
    opacity: 0.5,
  });
  const rotatedAnnotated = await surface.runtime.editing?.exportPdf();
  if (!rotatedAnnotated) throw new Error('Missing rotated annotated export');
  const rotatedPrint = await surface.runtime.preparePrintDocument?.();
  if (!rotatedPrint) throw new Error('Missing rotated annotated print');
  check(
    (await reopened(engine, rotatedPrint)).rotations.join() === '90,90,90',
    'Printing an annotated rotated page lost its Page Rotation',
  );
  await surface.runtime.destroy();

  const original = navigationPdf('Native annotations');
  ({ surface, annotations, engine, history, registry } = await open(original));
  const editing = surface.runtime.editing;
  if (!editing?.rotatePages) throw new Error('Native editing cannot rotate pages');
  annotations.createAnnotation(0, {
    id: 'turned-highlight',
    type: PdfAnnotationSubtype.HIGHLIGHT,
    pageIndex: 0,
    rect: HIGHLIGHT_RECT,
    segmentRects: [HIGHLIGHT_RECT],
    strokeColor: '#FFFF00',
    opacity: 0.5,
    contents: 'Stays on its text',
  });
  annotations.createAnnotation(0, {
    id: 'turned-note',
    type: PdfAnnotationSubtype.TEXT,
    pageIndex: 0,
    rect: { origin: { x: 260, y: 100 }, size: { width: 24, height: 24 } },
    contents: 'Turned note',
  });
  const before = editing.state().revision;
  editing.rotatePages([1], 'clockwise');
  check(editing.state().dirty && editing.state().revision > before, 'Rotation is not unsaved work');
  const manager = registry
    .getPlugin<import('@embedpdf/snippet').DocumentManagerPlugin>('document-manager')
    ?.provides();
  const livePage = () => manager?.getActiveDocument()?.pages[0];
  const scroll = registry
    .getPlugin<import('@embedpdf/snippet').ScrollPlugin>('scroll')
    ?.provides()
    .forDocument(manager?.getActiveDocumentId() ?? '');
  const firstPageLayout = () => scroll?.getLayout().virtualItems[0]?.pageLayouts[0];
  check(
    livePage()?.rotation === 1 &&
      (firstPageLayout()?.rotatedWidth ?? 0) > (firstPageLayout()?.rotatedHeight ?? 0),
    `The viewer does not show the turned page: ${JSON.stringify(firstPageLayout())}`,
  );
  const liveHighlight = () => annotations.getAnnotationById('turned-highlight')?.object;
  check(
    sameRect(liveHighlight()?.rect, HIGHLIGHT_RECT),
    `A highlight left its text when its page turned: ${JSON.stringify(liveHighlight()?.rect)}`,
  );
  const turned = await editing.exportPdf();
  let saved = await reopened(engine, turned);
  check(saved.rotations.join() === '90,0,0', `Saved rotations: ${saved.rotations.join()}`);
  check(
    sameRect(saved.annotations.find(({ id }) => id === 'turned-highlight')?.rect, HIGHLIGHT_RECT) &&
      saved.annotations.some(({ id }) => id === 'turned-note') &&
      saved.annotations.some(({ rect }) => sameRect(rect, LINK_RECT)),
    'Annotations on a turned page did not survive its save',
  );

  history.undo();
  check(
    livePage()?.rotation === 0 &&
      (firstPageLayout()?.rotatedWidth ?? 0) < (firstPageLayout()?.rotatedHeight ?? 0),
    'Undo did not restore the Page Rotation',
  );
  check(sameRect(liveHighlight()?.rect, HIGHLIGHT_RECT), 'Undo misplaced the highlight');
  saved = await reopened(engine, await editing.exportPdf());
  check(saved.rotations.join() === '0,0,0', `Undone rotations: ${saved.rotations.join()}`);
  history.redo();
  check(livePage()?.rotation === 1, 'Redo did not reapply the Page Rotation');
  editing.rotatePages([1, 2], 'counterclockwise');
  saved = await reopened(engine, await editing.exportPdf());
  check(
    saved.rotations.join() === '0,270,0',
    `Counter-clockwise rotations: ${saved.rotations.join()}`,
  );
  check(
    sameRect(saved.annotations.find(({ id }) => id === 'turned-highlight')?.rect, HIGHLIGHT_RECT),
    'A full turn back misplaced the highlight',
  );
  let refused = false;
  try {
    editing.rotatePages([4], 'clockwise');
  } catch {
    refused = true;
  }
  check(refused, 'Rotating a page the Document lacks was accepted');
  await surface.runtime.destroy();

  ({ surface } = await open(original, 'Read-only rotation'));
  refused = false;
  try {
    surface.runtime.editing?.rotatePages?.([1], 'clockwise');
  } catch (error) {
    refused = String(error).includes('Read-only rotation');
  }
  check(refused, 'A read-only Document accepted a Page Rotation');
  check(!surface.runtime.editing?.state().dirty, 'Refused rotation made the Document dirty');
  await surface.runtime.destroy();
  return turned;
}

/** Printing reproduces the PDF's own Page Rotation, editable or read-only. */
async function verifyPrintedPageRotation(): Promise<void> {
  const rotated = navigationPdf('Native Page Rotation', 90, false);
  for (const readOnlyReason of [null, 'Read-only print path']) {
    const { surface, engine } = await open(rotated, readOnlyReason);
    const printed = await surface.runtime.preparePrintDocument?.();
    if (!printed?.length) throw new Error('Missing rotated print output');
    const rotations = await printedPageRotations(engine, printed);
    check(
      JSON.stringify(rotations) === JSON.stringify([90, 90, 90]),
      `Printing must reproduce the PDF's own Page Rotation (${readOnlyReason ?? 'editable'}): ${JSON.stringify(rotations)}`,
    );
    await surface.runtime.destroy();
  }
}

const waitFor = async (condition: () => boolean, message: string): Promise<void> => {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 20));
  check(condition(), message);
};

/** The Highlight split button's two paths: mark the selection, or highlight mode. */
async function verifyHighlightSplitButton(): Promise<void> {
  const green = '#7ED957';
  const { surface, annotations, registry } = await open(navigationPdf('Highlight split button'));
  const documentId = registry
    .getPlugin<import('@embedpdf/snippet').DocumentManagerPlugin>('document-manager')
    ?.provides()
    .getActiveDocumentId();
  const selection = registry
    .getPlugin<import('@embedpdf/snippet').SelectionPlugin>('selection')
    ?.provides()
    .forDocument(documentId ?? '');
  if (!selection) throw new Error('Missing text selection capability');
  const highlights = () =>
    annotations
      .getAnnotations()
      .filter(({ object }) => object.type === PdfAnnotationSubtype.HIGHLIGHT);

  check(
    surface.rendering.markupSelection?.('highlight', { strokeColor: green }) === false,
    'Highlight marked text with nothing selected',
  );
  await selection
    .setSelection({ start: { page: 0, index: 0 }, end: { page: 0, index: 6 } })
    .toPromise();
  check(selection.getFormattedSelection().length === 1, 'Text selection did not take hold');
  check(
    surface.rendering.markupSelection?.('highlight', { strokeColor: green }) === true,
    'Highlight did not mark the selected text',
  );
  await waitFor(() => highlights().length === 1, 'The selected text was not highlighted');
  check(selection.getFormattedSelection().length === 0, 'The highlighted selection remained');
  check(surface.runtime.editing?.state().dirty, 'A new highlight did not mark the Document dirty');
  const saved = await surface.runtime.editing?.exportPdf();
  if (!saved) throw new Error('Missing highlighted export');

  surface.rendering.setActiveAnnotationTool?.('highlight', { strokeColor: '#B78CF2' });
  check(
    annotations.getActiveTool()?.id === 'highlight' &&
      annotations.getTool('highlight')?.defaults.strokeColor === '#B78CF2',
    'Highlight mode did not take the chosen colour',
  );
  surface.rendering.setActiveAnnotationTool?.(null);
  await surface.runtime.destroy();

  const reopened = await open(saved);
  const mark = reopened.annotations
    .getAnnotations()
    .map(({ object }) => object)
    .find((object) => object.type === PdfAnnotationSubtype.HIGHLIGHT);
  check(
    mark?.type === PdfAnnotationSubtype.HIGHLIGHT &&
      mark.strokeColor?.toLowerCase() === green.toLowerCase() &&
      mark.segmentRects.length > 0,
    `The saved highlight lost its colour or text: ${JSON.stringify(mark)}`,
  );
  await reopened.surface.runtime.destroy();

  const signed = await open(
    saved,
    'Digitally signed PDFs are read-only to preserve their signatures',
  );
  check(
    signed.surface.rendering.markupSelection?.('highlight', { strokeColor: green }) === false,
    'A protected Document accepted a highlight',
  );
  await signed.surface.runtime.destroy();
}

async function run() {
  await verifyProtectedDocuments();
  await verifyHighlightSplitButton();
  const original = navigationPdf('Native annotations');
  const failed = await open(original);
  const createNativeAnnotation = failed.engine.createPageAnnotation;
  failed.engine.createPageAnnotation = () =>
    PdfTaskHelper.reject({
      code: PdfErrorCode.Unknown,
      message: 'Injected native annotation failure',
    });
  failed.annotations.createAnnotation(0, {
    id: 'failed-comment',
    type: PdfAnnotationSubtype.TEXT,
    pageIndex: 0,
    rect: { origin: { x: 72, y: 80 }, size: { width: 24, height: 24 } },
    contents: 'Must remain unsaved',
  });
  let rejected = false;
  try {
    await failed.surface.runtime.editing?.exportPdf();
  } catch {
    rejected = true;
  }
  check(rejected, 'A failed native annotation commit was accepted as a successful export');
  check(
    failed.surface.runtime.editing?.state().dirty,
    'Failed native mutation lost its dirty state',
  );
  check(
    failed.annotations
      .getAnnotations()
      .some(({ object }) => object.contents === 'Must remain unsaved'),
    'Failed native mutation lost live annotation work',
  );
  failed.engine.createPageAnnotation = createNativeAnnotation;
  const retried = await failed.surface.runtime.editing?.exportPdf();
  check(retried && retried.length > 0, 'Native annotation failure could not be retried');
  check(
    failed.surface.runtime.editing?.state().dirty,
    'Export incorrectly acknowledged a durable save',
  );
  const updateNativeAnnotation = failed.engine.updatePageAnnotation;
  failed.engine.updatePageAnnotation = () =>
    PdfTaskHelper.reject({ code: PdfErrorCode.Unknown, message: 'Injected update failure' });
  failed.annotations.updateAnnotation(0, 'failed-comment', {
    contents: 'Retry the updated comment',
  });
  rejected = false;
  try {
    await failed.surface.runtime.editing?.exportPdf();
  } catch {
    rejected = true;
  }
  check(rejected, 'A failed native update was accepted');
  failed.engine.updatePageAnnotation = updateNativeAnnotation;
  await failed.surface.runtime.editing?.exportPdf();
  const movedNoteRect = { origin: { x: 89, y: 113 }, size: { width: 31, height: 27 } };
  failed.annotations.updateAnnotation(0, 'failed-comment', { rect: movedNoteRect });
  failed.engine.updatePageAnnotation = (...args) =>
    args[3]?.regenerateAppearance === false
      ? PdfTaskHelper.resolve(false)
      : updateNativeAnnotation(...args);
  rejected = false;
  try {
    await failed.surface.runtime.editing?.exportPdf();
  } catch {
    rejected = true;
  }
  check(rejected, 'A failed native note geometry restoration was accepted');
  failed.engine.updatePageAnnotation = updateNativeAnnotation;
  const movedNoteBytes = await failed.surface.runtime.editing?.exportPdf();
  if (!movedNoteBytes) throw new Error('Missing moved note export');
  const movedDocument = await failed.engine
    .openDocumentBuffer({ id: 'verify-moved-note', content: movedNoteBytes.buffer as ArrayBuffer })
    .toPromise();
  try {
    const movedObjects = await failed.engine
      .getPageAnnotations(movedDocument, movedDocument.pages[0])
      .toPromise();
    check(
      JSON.stringify(movedObjects.find(({ id }) => id === 'failed-comment')?.rect) ===
        JSON.stringify(movedNoteRect),
      'Native note export lost a deliberate move or resize',
    );
  } finally {
    await failed.engine.closeDocument(movedDocument).toPromise();
  }
  const deleteNativeAnnotation = failed.engine.removePageAnnotation;
  failed.engine.removePageAnnotation = () =>
    PdfTaskHelper.reject({ code: PdfErrorCode.Unknown, message: 'Injected deletion failure' });
  failed.annotations.deleteAnnotation(0, 'failed-comment');
  rejected = false;
  try {
    await failed.surface.runtime.editing?.exportPdf();
  } catch {
    rejected = true;
  }
  check(rejected, 'A failed native deletion was accepted');
  failed.engine.removePageAnnotation = deleteNativeAnnotation;
  await failed.surface.runtime.editing?.exportPdf();
  await failed.surface.runtime.destroy();
  let { surface, annotations, history } = await open(original);
  check(!annotations.isToolLocked('highlight'), 'Highlight is locked');
  check(!annotations.isToolLocked('textComment'), 'Comment is locked');
  check(!annotations.isToolLocked('underline'), 'Admitted Underline is locked');
  check(!annotations.isToolLocked('strikeout'), 'Admitted Strikethrough is locked');
  check(annotations.isToolLocked('squiggly'), 'Unverified Squiggly is enabled');
  check(annotations.isToolLocked('ink'), 'Unsupported ink tool is enabled');
  const rect = { origin: { x: 72, y: 50 }, size: { width: 160, height: 24 } };
  annotations.createAnnotation(0, {
    id: 'highlight-native',
    type: PdfAnnotationSubtype.HIGHLIGHT,
    pageIndex: 0,
    rect,
    segmentRects: [rect],
    opacity: 0.5,
    strokeColor: '#FFFF00',
    contents: 'Native highlight',
  });
  annotations.createAnnotation(0, {
    id: 'comment-native',
    type: PdfAnnotationSubtype.TEXT,
    pageIndex: 0,
    rect: { origin: { x: 260, y: 100 }, size: { width: 24, height: 24 } },
    contents: 'Native comment',
  });
  surface.runtime.editing?.setAnnotationDisplayName?.(
    normalizeAnnotationDisplayName('Ada Lovelace'),
  );
  const commentDefaults = annotations.getTool('textComment')?.defaults;
  if (!commentDefaults) throw new Error('Missing native comment tool defaults');
  annotations.createAnnotation(0, {
    ...commentDefaults,
    id: 'attributed-comment-native',
    type: PdfAnnotationSubtype.TEXT,
    pageIndex: 0,
    rect: { origin: { x: 300, y: 140 }, size: { width: 24, height: 24 } },
    contents: 'Attributed comment',
  });
  check(surface.runtime.editing?.state().dirty, 'Native edits did not mark Document dirty');
  history.undo();
  history.redo();
  await surface.rendering.setZoomIntent({ kind: 'manual', scale: 1.75 });
  surface.rendering.applyFilter('invert(1) sepia(1)');
  const printed = await surface.runtime.preparePrintDocument?.();
  if (!printed?.length) throw new Error('Missing annotated print output');
  check(surface.runtime.editing?.state().dirty, 'Printing incorrectly marked annotations saved');
  const annotated = await surface.runtime.editing?.exportPdf();
  if (!annotated) throw new Error('Missing native export');
  await surface.runtime.destroy();
  ({ surface, annotations } = await open(printed));
  check(
    annotations.getAnnotations().some(({ object }) => object.contents === 'Native highlight'),
    'Printed bytes omitted the current native highlight',
  );
  check(
    annotations.getAnnotations().some(({ object }) => object.contents === 'Native comment'),
    'Printed bytes omitted the current native comment',
  );
  await surface.runtime.destroy();
  await verifyPrintedPageRotation();
  const rotated = await verifyPageRotationEdits();
  ({ surface, annotations, history } = await open(annotated));
  const objects = annotations.getAnnotations().map((annotation) => annotation.object);
  const highlight = objects.find((object) => object.type === PdfAnnotationSubtype.HIGHLIGHT);
  const comment = objects.find((object) => object.contents === 'Native comment');
  const attributedComment = objects.find((object) => object.contents === 'Attributed comment');
  check(highlight?.contents === 'Native highlight', 'Native highlight did not survive reopen');
  check(comment?.contents === 'Native comment', 'Native comment did not survive reopen');
  check(
    highlight?.author === 'Guest' && comment?.author === 'Guest',
    'Changing attribution rewrote an existing author',
  );
  check(
    attributedComment?.author === 'Ada Lovelace',
    'Changed attribution was not applied to a newly authored annotation',
  );
  if (!highlight || !comment || !attributedComment) throw new Error('Missing native annotations');
  annotations.selectAnnotation(0, comment.id);
  check(annotations.getSelectedAnnotations().length === 1, 'Reopened comment is not selectable');
  annotations.updateAnnotation(0, comment.id, { contents: 'Edited after reopen' });
  annotations.updateAnnotation(0, attributedComment.id, {
    contents: 'Edited attributed comment',
  });
  check(
    annotations.getAnnotationById(attributedComment.id)?.object.author === 'Ada Lovelace',
    'Editing an existing annotation rewrote its author',
  );
  annotations.deleteAnnotation(0, highlight.id);
  annotations.deleteAnnotation(0, comment.id);
  annotations.deleteAnnotation(0, attributedComment.id);
  const deleted = await surface.runtime.editing?.exportPdf();
  if (!deleted) throw new Error('Missing deletion export');
  await surface.runtime.destroy();
  ({ surface, annotations } = await open(deleted));
  check(
    annotations.getAnnotations().every(({ object }) => object.type === PdfAnnotationSubtype.LINK),
    'Deleted annotations survived re-save',
  );
  window.nativeAnnotationSmoke = {
    original: Array.from(original),
    annotated: Array.from(annotated),
    deleted: Array.from(deleted),
    rotated: Array.from(rotated),
    annotations: objects,
  };
  document.body.dataset.status = 'ready';
}
void run().catch((error) => {
  document.body.dataset.status = 'failed';
  document.body.dataset.error = String(error);
  console.error(error);
});
