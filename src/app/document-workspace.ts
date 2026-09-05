import { debugLog } from '../lib/debug-log';
import type { PdfLinkTarget } from '../lib/pdf-links';
import { type AnnotationAccess, createTransientAnnotationAccess } from '../reader/annotations';
import type { DocumentAccess } from '../reader/document-access';
import type {
  LoadableDocumentContent,
  ResolvedDocumentLinkTarget,
} from '../reader/document-content';
import type { DocumentRuntimeIntake, DocumentRuntimeOpenRequest } from '../reader/document-intake';
import type { DocumentQuery, DocumentRuntime } from '../reader/document-queries';
import type { DocumentRendering } from '../reader/document-rendering';
import { createPdfDocumentContent } from '../reader/pdf-document-content';
import type {
  ReaderAction,
  ReaderActionOptions,
  ReaderActionOutcome,
  ReaderProjection,
  ReadingPosition,
  ReadingSessionDocument,
  ReadingSessionSnapshot,
  ReadingSessionVisualState,
  RestorableReadingPosition,
  ZoomIntent,
} from '../reader/reader-actions';
import { buildFilterCSS } from '../scripts/filters';
import {
  type AnnotationNoteRequester,
  PDFViewer,
  type PdfPasswordRequester,
} from '../scripts/pdf-viewer';

export interface DocumentSurface {
  readonly rendering: DocumentRendering;
  readonly runtime: DocumentRuntime;
}

export interface DocumentSurfaceCallbacks {
  readonly readingPositionObserved: (position: ReadingPosition) => void;
  readonly readingPositionSettled: (position: ReadingPosition) => void;
  readonly stateChanged: () => void;
  readonly pageNavigationRequested: (page: number, options?: ReaderActionOptions) => Promise<void>;
  readonly zoomIntentRequested: (zoomIntent: ZoomIntent) => Promise<void>;
}

export interface DocumentSurfaceFactoryRequest {
  readonly filePath: string;
  readonly title: string;
  readonly bytes: Uint8Array;
  readonly callbacks: DocumentSurfaceCallbacks;
}

export type DocumentSurfaceFactory = (
  request: DocumentSurfaceFactoryRequest,
) => Promise<DocumentSurface>;

interface DocumentWorkspaceOptions {
  dispatch(action: ReaderAction): Promise<ReaderActionOutcome>;
  snapshot(): ReadingSessionSnapshot;
  defaultVisualState(): ReadingSessionVisualState;
  createSurface?: DocumentSurfaceFactory;
  annotationAuthority?: AnnotationAccess;
  requestPassword?: PdfPasswordRequester;
  requestAnnotationNote?: AnnotationNoteRequester;
  reportError?: (message: string) => void;
  resolveLinkTarget?: (
    filePath: string,
    target: PdfLinkTarget,
  ) => Promise<ResolvedDocumentLinkTarget | null>;
  activateLinkTarget?: (filePath: string, target: PdfLinkTarget) => Promise<void>;
  documentOpened?: (filePath: string, title: string) => void | Promise<void>;
  activeDocumentChanged?: () => void | Promise<void>;
  renderingStateChanged?: () => void;
}

export interface DocumentWorkspace {
  readonly intakeRuntime: DocumentRuntimeIntake;
  readonly projection: ReaderProjection;
  project(snapshot: ReadingSessionSnapshot): void;
  access(query: DocumentQuery | null): DocumentAccess | null;
  activeRendering(): DocumentRendering | null;
  activeRenderingState(): ReturnType<DocumentRendering['getState']> | null;
  activeReadingPosition(): { filePath: string; readingPosition: ReadingPosition } | null;
  replaceAnnotations(filePath: string | null): void;
}

interface PresentedDocument {
  readonly id: string;
  readonly title: string;
  readonly rendering: DocumentRendering;
}

const cloneZoomIntent = (zoomIntent: ZoomIntent): ZoomIntent =>
  zoomIntent.kind === 'manual'
    ? { kind: 'manual', scale: zoomIntent.scale }
    : { kind: zoomIntent.kind };

async function projectDocumentState(
  rendering: DocumentRendering,
  documentState: Pick<ReadingSessionDocument, 'readingPosition' | 'visualState'>,
): Promise<void> {
  if (documentState.visualState) {
    rendering.applyFilter(buildFilterCSS(documentState.visualState.filterSettings));
    await rendering.setRotation(documentState.visualState.rotation);
    await rendering.setViewMode(documentState.visualState.viewMode);
    await rendering.setZoomIntent(documentState.visualState.zoomIntent);
  }
  await rendering.goToReadingPosition(documentState.readingPosition);
}

export function createDocumentWorkspace(options: DocumentWorkspaceOptions): DocumentWorkspace {
  const annotationAuthority = options.annotationAuthority ?? createTransientAnnotationAccess();
  const presented = new Map<string, PresentedDocument>();
  let visibleDocumentPath: string | null = null;

  const requireRendering = (filePath: string): DocumentRendering => {
    const rendering = presented.get(filePath)?.rendering;
    if (!rendering) throw new Error(`Cannot render unopened Document: ${filePath}`);
    return rendering;
  };

  const createPdfSurface: DocumentSurfaceFactory = async ({
    filePath,
    title,
    bytes,
    callbacks,
  }) => {
    const content: LoadableDocumentContent = createPdfDocumentContent({
      requestPassword: options.requestPassword,
    });
    const resolveLinkTarget = options.resolveLinkTarget;
    const activateLinkTarget = options.activateLinkTarget;
    const rendering = new PDFViewer('pdf-container', `pdf-canvas-${crypto.randomUUID()}`, {
      content,
      requestAnnotationNote: options.requestAnnotationNote,
      reportError: options.reportError,
      ...(resolveLinkTarget
        ? { resolveLinkTarget: (target) => resolveLinkTarget(filePath, target) }
        : {}),
      ...(activateLinkTarget
        ? {
            activateLinkTarget: (target) => activateLinkTarget(filePath, target),
          }
        : {}),
    });
    rendering.setOnPageChange(callbacks.stateChanged);
    rendering.setOnScrollChange(() =>
      callbacks.readingPositionObserved(rendering.getReadingPosition()),
    );
    rendering.setOnScrollSettled(() =>
      callbacks.readingPositionSettled(rendering.getReadingPosition()),
    );
    rendering.setOnPageNavigationRequest(callbacks.pageNavigationRequested);
    rendering.setOnZoomIntentRequest(callbacks.zoomIntentRequested);
    rendering.setAnnotations(annotationAuthority.snapshot(filePath));
    rendering.setOnAnnotationsChange((annotations) => {
      annotationAuthority.replace(filePath, annotations);
      callbacks.stateChanged();
    });
    try {
      await rendering.loadPDF(bytes, title, filePath);
    } catch (error) {
      rendering.destroy();
      await content.destroy();
      throw error;
    }
    let destroyed = false;
    return {
      rendering,
      runtime: {
        content,
        renderThumbnail: (pageNumber, thumbnailOptions) =>
          rendering.renderThumbnail(pageNumber, thumbnailOptions),
        getAnnotations: () => annotationAuthority.snapshot(filePath),
        async destroy() {
          if (destroyed) return;
          destroyed = true;
          await content.destroy();
        },
      },
    };
  };
  const createSurface = options.createSurface ?? createPdfSurface;

  const renderDocumentControls = (readingSession: ReadingSessionSnapshot): void => {
    const container = document.getElementById('tab-container');
    if (!container) return;
    const workspace = document.getElementById('document-workspace');
    container.replaceChildren();

    for (const documentState of readingSession.documents) {
      const id = presented.get(documentState.filePath)?.id ?? crypto.randomUUID();
      const active = documentState.filePath === readingSession.activeDocumentPath;
      const item = document.createElement('div');
      item.className = `tab-item ${active ? 'active' : ''}`;
      const control = document.createElement('button');
      control.type = 'button';
      control.className = `tab ${active ? 'active' : ''}`;
      control.dataset.tabId = id;
      control.dataset.filePath = documentState.filePath;
      control.id = `document-tab-${id}`;
      control.setAttribute('role', 'tab');
      control.setAttribute('aria-selected', active ? 'true' : 'false');
      control.setAttribute('aria-controls', 'document-workspace');
      control.tabIndex = active ? 0 : -1;
      if (active) workspace?.setAttribute('aria-labelledby', control.id);

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = documentState.title;
      title.title = documentState.title;
      control.append(title);
      control.addEventListener('click', () => {
        void options.dispatch({ type: 'activateDocument', filePath: documentState.filePath });
      });

      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '✕';
      close.title = 'Close document';
      close.setAttribute('aria-label', `Close ${documentState.title}`);
      close.tabIndex = active ? 0 : -1;
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        void options.dispatch({ type: 'closeDocument', filePath: documentState.filePath });
      });
      item.append(control, close);
      container.append(item);
    }
  };

  const activate = async (
    filePath: string,
    readingPosition?: RestorableReadingPosition,
    visualState?: ReadingSessionVisualState,
  ): Promise<void> => {
    const rendering = requireRendering(filePath);
    for (const [path, documentState] of presented) {
      documentState.rendering.setVisible(path === filePath);
    }
    visibleDocumentPath = filePath;
    if (visualState) {
      await projectDocumentState(rendering, {
        readingPosition: readingPosition ?? rendering.getReadingPosition(),
        visualState,
      });
    } else if (readingPosition) {
      await rendering.goToReadingPosition(readingPosition);
    }
    await options.activeDocumentChanged?.();
  };

  const projection: ReaderProjection = {
    activateDocument: activate,
    async closeDocument(filePath, nextActiveDocumentPath) {
      const documentState = presented.get(filePath);
      if (!documentState) return;
      documentState.rendering.destroy();
      presented.delete(filePath);
      if (visibleDocumentPath === filePath) {
        visibleDocumentPath = null;
        if (nextActiveDocumentPath && presented.has(nextActiveDocumentPath)) {
          await activate(nextActiveDocumentPath);
        } else {
          await options.activeDocumentChanged?.();
        }
      }
    },
    goToReadingPosition: (filePath, position, actionOptions) =>
      requireRendering(filePath).goToReadingPosition(position, actionOptions),
    getPageCount: (filePath) => requireRendering(filePath).getState().totalPages,
    async applyZoomIntent(filePath, zoomIntent, actionOptions) {
      const rendering = requireRendering(filePath);
      await rendering.setZoomIntent(zoomIntent, actionOptions);
      return cloneZoomIntent(rendering.getState().zoomIntent);
    },
    async applyRelativeZoom(filePath, direction, actionOptions) {
      const rendering = requireRendering(filePath);
      await (direction === 'in'
        ? rendering.zoomIn(actionOptions)
        : rendering.zoomOut(actionOptions));
      return cloneZoomIntent(rendering.getState().zoomIntent);
    },
    applyRotation: (filePath, rotation, actionOptions) =>
      requireRendering(filePath).setRotation(rotation, actionOptions),
    applyViewMode: (filePath, viewMode, actionOptions) =>
      requireRendering(filePath).setViewMode(viewMode, actionOptions),
    async applyFilterSettings(filePath, filterSettings, actionOptions) {
      if (actionOptions?.isCancelled?.()) return;
      requireRendering(filePath).applyFilter(buildFilterCSS(filterSettings), actionOptions);
    },
  };

  const intakeRuntime: DocumentRuntimeIntake = {
    isOpen: (filePath) => presented.has(filePath),
    async activate(filePath, activateOptions) {
      const outcome = await options.dispatch({ type: 'activateDocument', filePath });
      if (outcome.status === 'failure') throw outcome.error;
      if (activateOptions?.notifyOpened !== false) {
        const documentState = options
          .snapshot()
          .documents.find((item) => item.filePath === filePath);
        if (documentState) await options.documentOpened?.(filePath, documentState.title);
      }
    },
    async notifyOpened(filePath) {
      const documentState = options.snapshot().documents.find((item) => item.filePath === filePath);
      if (!documentState) throw new Error(`Cannot notify for unopened Document: ${filePath}`);
      await options.documentOpened?.(filePath, documentState.title);
    },
    async open(request: DocumentRuntimeOpenRequest) {
      const { document, bytes, initialPage, restoredDocument } = request;
      const dispatchForDocument = async (action: ReaderAction): Promise<void> => {
        const outcome = await options.dispatch(action);
        if (outcome.status === 'failure') throw outcome.error;
      };
      const callbacks: DocumentSurfaceCallbacks = {
        stateChanged: () => options.renderingStateChanged?.(),
        readingPositionObserved: (readingPosition) => {
          void options.dispatch({
            type: 'settleReadingPosition',
            filePath: document.canonicalPath,
            readingPosition,
          });
        },
        readingPositionSettled: (readingPosition) => {
          void options.dispatch({
            type: 'settleReadingPosition',
            filePath: document.canonicalPath,
            readingPosition,
          });
        },
        pageNavigationRequested: (page) =>
          dispatchForDocument({ type: 'goToPage', filePath: document.canonicalPath, page }),
        zoomIntentRequested: (zoomIntent) =>
          dispatchForDocument({
            type: 'setZoomIntent',
            filePath: document.canonicalPath,
            zoomIntent,
          }),
      };
      const surface = await createSurface({
        filePath: document.canonicalPath,
        title: document.title,
        bytes,
        callbacks,
      });
      presented.set(document.canonicalPath, {
        id: crypto.randomUUID(),
        title: document.title,
        rendering: surface.rendering,
      });
      surface.rendering.setVisible(false);

      const initialDocument: ReadingSessionDocument = restoredDocument
        ? { ...restoredDocument, filePath: document.canonicalPath, title: document.title }
        : {
            filePath: document.canonicalPath,
            title: document.title,
            readingPosition: { page: initialPage ?? 1, location: 0 },
            visualState: options.defaultVisualState(),
          };
      try {
        await projectDocumentState(surface.rendering, initialDocument);
        await dispatchForDocument({
          type: 'registerDocument',
          document: initialDocument,
          runtime: surface.runtime,
        });
        if (request.activate) {
          await dispatchForDocument({
            type: 'activateDocument',
            filePath: document.canonicalPath,
            ...(initialPage !== undefined
              ? { readingPosition: surface.rendering.getReadingPosition() }
              : {}),
          });
        }
      } catch (error) {
        presented.delete(document.canonicalPath);
        surface.rendering.destroy();
        await surface.runtime.destroy();
        throw error;
      }
      if (request.notifyOpened !== false) {
        await options.documentOpened?.(document.canonicalPath, document.title);
      }
      debugLog(`Prepared Document surface: ${document.title}`);
    },
    async goToPage(filePath, page) {
      const outcome = await options.dispatch({ type: 'goToPage', filePath, page });
      if (outcome.status === 'failure') throw outcome.error;
    },
    async restoreExistingDocument(filePath, documentState, { preserveReadingPosition }) {
      const rendering = requireRendering(filePath);
      const currentDocument = options
        .snapshot()
        .documents.find((item) => item.filePath === filePath);
      if (!currentDocument) throw new Error(`Cannot restore unopened Document: ${filePath}`);
      const restoredDocument = {
        ...documentState,
        filePath,
        readingPosition: preserveReadingPosition
          ? currentDocument.readingPosition
          : documentState.readingPosition,
      };
      try {
        await projectDocumentState(rendering, restoredDocument);
      } catch (error) {
        try {
          await projectDocumentState(rendering, currentDocument);
        } catch (rollbackError) {
          console.error('Failed to restore the previous Document presentation:', rollbackError);
        }
        throw error;
      }
      return restoredDocument;
    },
    setDocumentOrder: () => undefined,
  };

  return {
    intakeRuntime,
    projection,
    project: renderDocumentControls,
    access(query) {
      if (!query) return null;
      const rendering = presented.get(query.filePath)?.rendering;
      return rendering ? { query, rendering } : null;
    },
    activeRendering() {
      const filePath = options.snapshot().activeDocumentPath;
      return filePath ? (presented.get(filePath)?.rendering ?? null) : null;
    },
    activeRenderingState() {
      return this.activeRendering()?.getState() ?? null;
    },
    activeReadingPosition() {
      const filePath = options.snapshot().activeDocumentPath;
      const rendering = filePath ? presented.get(filePath)?.rendering : null;
      return filePath && rendering
        ? { filePath, readingPosition: rendering.getReadingPosition() }
        : null;
    },
    replaceAnnotations(filePath) {
      for (const [path, documentState] of presented) {
        if (filePath !== null && path !== filePath) continue;
        documentState.rendering.setAnnotations(annotationAuthority.snapshot(path));
      }
    },
  };
}
