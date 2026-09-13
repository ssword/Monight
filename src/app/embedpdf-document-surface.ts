import type { DocumentContent } from '../reader/document-content';
import type { DocumentRuntime } from '../reader/document-queries';
import type { DocumentRendering, DocumentRenderingState } from '../reader/document-rendering';
import { createInternalDocumentPage } from '../reader/internal-document-page';
import {
  type AnnotationDisplayName,
  DEFAULT_ANNOTATION_DISPLAY_NAME,
} from '../reader/native-pdf-editing';
import type { ReaderActionOptions } from '../reader/reader-actions';
import type { DocumentSurface, DocumentSurfaceFactory } from './document-workspace';
import { createEmbedPdfViewerRuntime, type EmbedPdfViewerRuntime } from './embedpdf-viewer-runtime';

type EmbedPdfViewerFactory = typeof createEmbedPdfViewerRuntime;

interface CreateEmbedPdfDocumentSurfaceFactoryOptions {
  readonly assessEditing?: (bytes: Uint8Array) => Promise<string | null>;
  readonly getAnnotationDisplayName?: () => AnnotationDisplayName;
  readonly createViewer?: EmbedPdfViewerFactory;
  readonly requestPassword?: Parameters<EmbedPdfViewerFactory>[0]['requestPassword'];
}

export function createEmbedPdfDocumentSurfaceFactory({
  createViewer = createEmbedPdfViewerRuntime,
  requestPassword,
  assessEditing,
  getAnnotationDisplayName = () => DEFAULT_ANNOTATION_DISPLAY_NAME,
}: CreateEmbedPdfDocumentSurfaceFactoryOptions = {}): DocumentSurfaceFactory {
  return async ({ filePath, title, bytes, callbacks, signal }) => {
    if (signal?.aborted) throw new Error('Document Intake interrupted');
    const root = document.getElementById('pdf-container');
    if (!root) throw new Error("Container element 'pdf-container' not found");
    const target = document.createElement('div');
    target.className = 'embedpdf-document-surface';
    target.dataset.visible = 'false';
    root.append(target);
    let viewer: EmbedPdfViewerRuntime | null = null;
    const sourceBytes = bytes.slice();
    try {
      let readOnlyReason = 'Native editing safety inspection is unavailable';
      if (assessEditing) {
        try {
          readOnlyReason = (await assessEditing(sourceBytes)) ?? '';
        } catch {
          readOnlyReason = 'PDF safety inspection failed; this Document is read-only';
        }
      }
      viewer = await createViewer({
        target,
        callbacks,
        requestPassword,
        readOnlyReason: readOnlyReason || null,
        annotationDisplayName: getAnnotationDisplayName(),
      });
      if (assessEditing && readOnlyReason) {
        const status = document.createElement('div');
        status.className = 'pdf-read-only-status';
        status.setAttribute('role', 'status');
        status.textContent = readOnlyReason;
        target.prepend(status);
      }
      await viewer.open({ bytes: sourceBytes, title, filePath, signal });
      if (signal?.aborted) throw new Error('Document Intake interrupted');
    } catch (error) {
      await viewer?.destroy();
      target.remove();
      throw error;
    }
    const openedViewer = viewer;

    let destroyPromise: Promise<void> | null = null;
    const destroy = (): Promise<void> => {
      destroyPromise ??= openedViewer.destroy().finally(() => target.remove());
      return destroyPromise;
    };
    const content: DocumentContent = {
      get pageCount() {
        return openedViewer.pageCount();
      },
      async getPage(pageNumber) {
        if (pageNumber < 1 || pageNumber > openedViewer.pageCount()) {
          throw new Error(`Invalid page number: ${pageNumber}`);
        }
        return createInternalDocumentPage(pageNumber, { pageNumber });
      },
      async getData() {
        return sourceBytes.slice();
      },
      search: (query, options) => openedViewer.search(query, options),
      getOutline: (options) => openedViewer.outline(options),
      getMetadata: (options) => openedViewer.metadata(options),
      resolveLinkTarget: (target, options) => openedViewer.resolveLinkTarget(target, options),
      destroy,
    };
    const project = (work: () => Promise<void>, options?: ReaderActionOptions): Promise<void> =>
      destroyPromise || options?.isCancelled?.() ? Promise.resolve() : work();
    const rendering: DocumentRendering = {
      getState(): DocumentRenderingState {
        return {
          currentPage: openedViewer.currentPage(),
          totalPages: openedViewer.pageCount(),
          zoom: openedViewer.currentZoom(),
          zoomIntent: openedViewer.zoomIntent(),
          rotation: openedViewer.rotation(),
          fileName: title,
          filePath,
          viewMode: openedViewer.viewMode(),
        };
      },
      openSearch: () => openedViewer.openSearch(),
      getScrollPosition: () => 0,
      getReadingPosition: () => openedViewer.readingPosition(),
      goToPage: (pageNumber, options) => project(() => openedViewer.goToPage(pageNumber), options),
      goToReadingPosition: (position, options) =>
        project(() => openedViewer.goToReadingPosition(position), options),
      setZoomIntent: (intent, options) =>
        project(() => openedViewer.setZoomIntent(intent), options),
      zoomIn: (options) => project(() => openedViewer.zoomIn(), options),
      zoomOut: (options) => project(() => openedViewer.zoomOut(), options),
      setRotation: (rotation, options) =>
        project(() => openedViewer.setRotation(rotation), options),
      setViewMode: (viewMode, options) =>
        project(() => openedViewer.setViewMode(viewMode), options),
      fitToPage: (options) => project(() => openedViewer.fitToPage(), options),
      applyFilter: (filterCss, options) => {
        if (!destroyPromise && !options?.isCancelled?.()) openedViewer.applyFilter(filterCss);
      },
      setVisible: (visible) => openedViewer.setVisible(visible),
      destroy() {
        void destroy();
      },
    };
    const runtime: DocumentRuntime = {
      ...(assessEditing && openedViewer.editing ? { editing: openedViewer.editing } : {}),
      preparePrintDocument: () => openedViewer.preparePrintDocument(),
      content,
      renderThumbnail: (pageNumber, options) =>
        openedViewer.renderThumbnail(pageNumber, options?.maxWidth),
      destroy,
    };
    return { rendering, runtime } satisfies DocumentSurface;
  };
}
