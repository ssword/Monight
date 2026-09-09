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

declare global {
  interface Window {
    nativeAnnotationSmoke?: {
      original: number[];
      annotated: number[];
      deleted: number[];
      annotations: unknown[];
    };
  }
}
const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

async function open(bytes: Uint8Array): Promise<{
  surface: DocumentSurface;
  annotations: AnnotationCapability;
  history: HistoryCapability;
  engine: import('@embedpdf/models').PdfEngine;
}> {
  const surface = await createEmbedPdfDocumentSurfaceFactory({ assessEditing: async () => null })({
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
  if (!container) throw new Error('Missing ready-made viewer');
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
  for (const id of ['annotation:add-highlight', 'annotation:add-comment', 'panel:toggle-comment']) {
    const command = commands.resolve(id);
    check(command.visible && !command.disabled, `Required native UI command is unavailable: ${id}`);
  }
  for (const id of [
    'document:export',
    'document:protect',
    'form:add-textfield',
    'annotation:add-ink',
    'annotation:apply-redaction',
  ]) {
    const command = commands.resolve(id);
    check(!command.visible || command.disabled, `Unsafe viewer command is available: ${id}`);
  }
  return { surface, annotations, history, engine: registry.getEngine() };
}

async function run() {
  const original = navigationPdf('Native annotations', 0, false);
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
  surface.runtime.editing?.setAnnotationDisplayName?.('Ada Lovelace');
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
  const annotated = await surface.runtime.editing?.exportPdf();
  if (!annotated) throw new Error('Missing native export');
  await surface.runtime.destroy();
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
    annotations: objects,
  };
  document.body.dataset.status = 'ready';
}
void run().catch((error) => {
  document.body.dataset.status = 'failed';
  document.body.dataset.error = String(error);
  console.error(error);
});
