import { awaitAbortableWork } from '../lib/abortable-work';
import { debugLog } from '../lib/debug-log';
import type { ViewMode } from '../lib/document-features';
import type { PdfLinkTarget } from '../lib/pdf-links';
import { type AnnotationAccess, createTransientAnnotationAccess } from '../reader/annotations';
import type { DocumentAccess, DocumentPresentation } from '../reader/document-access';
import type {
  LoadableDocumentContent,
  ResolvedDocumentLinkTarget,
} from '../reader/document-content';
import type { DocumentRuntimeIntake, DocumentRuntimeOpenRequest } from '../reader/document-intake';
import type { DocumentQuery, DocumentRuntime } from '../reader/document-queries';
import type { DocumentRendering, DocumentViewTransform } from '../reader/document-rendering';
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
import type { PresentationSurface } from './presentation-controller';

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
  readonly rotationRequested?: (direction: 'clockwise' | 'counter-clockwise') => Promise<void>;
  readonly viewModeRequested?: (viewMode: ViewMode) => Promise<void>;
  readonly linkTargetRequested?: (
    target: PdfLinkTarget,
    options?: ReaderActionOptions,
  ) => Promise<void>;
}

export interface DocumentSurfaceFactoryRequest {
  readonly filePath: string;
  readonly title: string;
  readonly bytes: Uint8Array;
  readonly callbacks: DocumentSurfaceCallbacks;
  readonly signal?: AbortSignal;
}

export type DocumentSurfaceFactory = (
  request: DocumentSurfaceFactoryRequest,
) => Promise<DocumentSurface>;

interface DocumentWorkspaceOptions {
  pdfSaveAdapter?: import('../reader/native-pdf-editing').NativePdfSaveAdapter;
  dispatchReaderAction(
    action: ReaderAction,
    options?: ReaderActionOptions,
  ): Promise<ReaderActionOutcome>;
  dispatchAcceptedIntakeAction?: (
    action: ReaderAction,
    options?: ReaderActionOptions,
  ) => Promise<ReaderActionOutcome>;
  acceptsReaderActions?: () => boolean;
  snapshot(): ReadingSessionSnapshot;
  isDocumentOpen(filePath: string): boolean;
  defaultVisualState(): ReadingSessionVisualState;
  createSurface?: DocumentSurfaceFactory;
  createDocumentContent?: (options: {
    readonly requestPassword?: PdfPasswordRequester;
  }) => LoadableDocumentContent;
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
  activePresentation(): PresentationSurface | null;
  activeRenderingState(): ReturnType<DocumentRendering['getState']> | null;
  activeReadingPosition(): { filePath: string; readingPosition: ReadingPosition } | null;
  viewTransform(filePath: string): DocumentViewTransform | null;
  replaceAnnotations(filePath: string | null): void;
}

interface PresentedDocument {
  readonly identity: { filePath: string; title: string };
  readonly runtime: DocumentRuntime;
  readonly id: string;
  readonly title: string;
  readonly rendering: DocumentRendering;
  readonly presentation: DocumentPresentation;
}

const cloneZoomIntent = (zoomIntent: ZoomIntent): ZoomIntent =>
  zoomIntent.kind === 'manual'
    ? { kind: 'manual', scale: zoomIntent.scale }
    : { kind: zoomIntent.kind };

async function projectDocumentState(
  rendering: DocumentRendering,
  documentState: Pick<ReadingSessionDocument, 'readingPosition' | 'visualState'>,
  options?: ReaderActionOptions,
): Promise<void> {
  if (documentState.visualState) {
    rendering.applyFilter(buildFilterCSS(documentState.visualState.filterSettings), options);
    await rendering.setRotation(documentState.visualState.rotation, options);
    await rendering.setViewMode(documentState.visualState.viewMode, options);
    await rendering.setZoomIntent(documentState.visualState.zoomIntent, options);
  }
  await rendering.goToReadingPosition(documentState.readingPosition, options);
}

export function createDocumentWorkspace(options: DocumentWorkspaceOptions): DocumentWorkspace {
  const annotationAuthority = options.annotationAuthority ?? createTransientAnnotationAccess();
  const presented = new Map<string, PresentedDocument>();
  let visibleDocumentPath: string | null = null;
  const disposedSurfaces = new WeakSet<DocumentSurface>();

  const interruptionError = (): Error => new Error('Document Intake interrupted');

  const disposeSurface = async (surface: DocumentSurface): Promise<unknown[]> => {
    if (disposedSurfaces.has(surface)) return [];
    disposedSurfaces.add(surface);
    const cleanupErrors: unknown[] = [];
    try {
      surface.rendering.destroy();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await surface.runtime.destroy();
    } catch (error) {
      cleanupErrors.push(error);
    }
    return cleanupErrors;
  };

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
    signal,
  }) => {
    const requestPassword = options.requestPassword;
    const requestDocumentPassword = requestPassword
      ? (fileName: string, reason: 'required' | 'incorrect') =>
          requestPassword(fileName, reason, signal)
      : undefined;
    const content: LoadableDocumentContent = options.createDocumentContent
      ? options.createDocumentContent({ requestPassword: requestDocumentPassword })
      : createPdfDocumentContent({ requestPassword: requestDocumentPassword });
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
      if (options.acceptsReaderActions?.() === false) return;
      annotationAuthority.replace(filePath, annotations);
      callbacks.stateChanged();
    });
    let loadDisposed = false;
    const disposeLoad = async (): Promise<void> => {
      if (loadDisposed) return;
      loadDisposed = true;
      rendering.destroy();
      await content.destroy();
    };
    const cancelLoad = (): void => {
      void disposeLoad();
    };
    if (signal?.aborted) {
      await disposeLoad();
      throw interruptionError();
    }
    signal?.addEventListener('abort', cancelLoad, { once: true });
    try {
      await rendering.loadPDF(bytes, title, filePath);
    } catch (error) {
      await disposeLoad();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancelLoad);
    }
    if (signal?.aborted) {
      await disposeLoad();
      throw interruptionError();
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
  const baseCreateSurface = options.createSurface ?? createPdfSurface;
  const createSurface: DocumentSurfaceFactory = async (request) => {
    const saveSource = await options.pdfSaveAdapter?.captureSource?.(
      request.filePath,
      request.bytes,
    );
    try {
      const surface = await baseCreateSurface(request);
      if (!saveSource) return surface;
      surface.runtime.saveSource = saveSource;
      const destroy = surface.runtime.destroy.bind(surface.runtime);
      surface.runtime.destroy = async () => {
        try {
          await destroy();
        } finally {
          const token = surface.runtime.saveSource;
          surface.runtime.saveSource = undefined;
          if (token) await options.pdfSaveAdapter?.releaseSource?.(token);
        }
      };
      return surface;
    } catch (error) {
      if (saveSource) await options.pdfSaveAdapter?.releaseSource?.(saveSource);
      throw error;
    }
  };

  const notifyDocumentOpened = async (filePath: string, title: string): Promise<void> => {
    try {
      await options.documentOpened?.(filePath, title);
    } catch (error) {
      console.error('Document Intake observer failed:', error);
    }
  };

  const dispatchOrThrow = async (
    dispatch: (action: ReaderAction, options?: ReaderActionOptions) => Promise<ReaderActionOutcome>,
    action: ReaderAction,
    actionOptions?: ReaderActionOptions,
  ): Promise<void> => {
    const outcome = await dispatch(action, actionOptions);
    if (outcome.status === 'failure') throw outcome.error;
  };
  const dispatchReaderActionOrThrow = (
    action: ReaderAction,
    actionOptions?: ReaderActionOptions,
  ): Promise<void> => dispatchOrThrow(options.dispatchReaderAction, action, actionOptions);
  const dispatchAcceptedIntakeActionOrThrow = async (
    action: ReaderAction,
    actionOptions?: ReaderActionOptions,
  ): Promise<ReaderActionOutcome> => {
    const outcome = await (options.dispatchAcceptedIntakeAction ?? options.dispatchReaderAction)(
      action,
      actionOptions,
    );
    if (outcome.status === 'failure') throw outcome.error;
    if (outcome.status === 'superseded') {
      throw new Error('Document Intake registration cancelled');
    }
    return outcome;
  };

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
      const editing = presented.get(documentState.filePath)?.runtime.editing?.state();
      title.textContent = documentState.title;
      title.title = documentState.title;
      control.append(title);
      if (editing?.dirty) {
        const indicator = document.createElement('span');
        indicator.className = 'tab-dirty-indicator';
        indicator.textContent = '•';
        indicator.setAttribute('aria-label', 'Unsaved changes');
        indicator.title = 'Unsaved changes';
        control.append(indicator);
      }
      control.addEventListener('click', () => {
        if (options.acceptsReaderActions?.() === false) return;
        void options.dispatchReaderAction({
          type: 'activateDocument',
          filePath: documentState.filePath,
        });
      });

      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '✕';
      close.title = 'Close document';
      close.setAttribute('aria-label', `Close ${documentState.title}`);
      close.tabIndex = active ? 0 : -1;
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        if (options.acceptsReaderActions?.() === false) return;
        void options
          .dispatchReaderAction({
            type: 'closeDocument',
            filePath: documentState.filePath,
          })
          .then((outcome) => {
            if (outcome.status === 'failure') options.reportError?.(String(outcome.error));
          });
      });
      item.append(control, close);
      if (editing) {
        for (const [label, type] of [
          ['Save', 'saveDocument'],
          ['Save As…', 'saveDocumentAs'],
        ] as const) {
          const save = document.createElement('button');
          save.type = 'button';
          save.className = type === 'saveDocument' ? 'tab-save' : 'tab-save-as';
          save.textContent = label;
          save.title = editing.readOnlyReason ?? label;
          save.disabled = Boolean(editing.readOnlyReason);
          save.addEventListener('click', () => {
            void options
              .dispatchReaderAction({ type, filePath: documentState.filePath })
              .then((outcome) => {
                if (outcome.status === 'failure') options.reportError?.(String(outcome.error));
              });
          });
          item.append(save);
        }
      }
      container.append(item);
    }
  };

  const activate = async (
    filePath: string,
    readingPosition?: RestorableReadingPosition,
    visualState?: ReadingSessionVisualState,
  ): Promise<void> => {
    const rendering = requireRendering(filePath);
    const previousVisibleDocumentPath = visibleDocumentPath;
    try {
      if (visualState) {
        await projectDocumentState(rendering, {
          readingPosition: readingPosition ?? rendering.getReadingPosition(),
          visualState,
        });
      } else if (readingPosition) {
        await rendering.goToReadingPosition(readingPosition);
      }
      for (const [path, documentState] of presented) {
        documentState.rendering.setVisible(path === filePath);
      }
      visibleDocumentPath = filePath;
      await options.activeDocumentChanged?.();
    } catch (error) {
      for (const [path, documentState] of presented) {
        documentState.rendering.setVisible(path === previousVisibleDocumentPath);
      }
      visibleDocumentPath = previousVisibleDocumentPath;
      throw error;
    }
  };

  const createCallbacks = (
    identity: { filePath: string; title: string },
    surfaceId: string,
  ): DocumentSurfaceCallbacks => {
    const isCurrentSurface = (): boolean =>
      presented.get(identity.filePath)?.id === surfaceId &&
      options.isDocumentOpen(identity.filePath);
    const dispatchSurfaceAction = async (
      action: ReaderAction,
      actionOptions?: ReaderActionOptions,
    ): Promise<void> => {
      if (!isCurrentSurface()) return;
      await dispatchReaderActionOrThrow(action, {
        ...actionOptions,
        isCancelled: () => !isCurrentSurface() || Boolean(actionOptions?.isCancelled?.()),
      });
    };
    const settleReadingPosition = (readingPosition: ReadingPosition): void => {
      void dispatchSurfaceAction({
        type: 'settleReadingPosition',
        filePath: identity.filePath,
        readingPosition,
      });
    };
    return {
      stateChanged: () => {
        if (isCurrentSurface()) {
          renderDocumentControls(options.snapshot());
          options.renderingStateChanged?.();
        }
      },
      readingPositionObserved: settleReadingPosition,
      readingPositionSettled: settleReadingPosition,
      pageNavigationRequested: (page, actionOptions) =>
        dispatchSurfaceAction(
          { type: 'goToPage', filePath: identity.filePath, page },
          actionOptions,
        ),
      zoomIntentRequested: (zoomIntent) =>
        dispatchSurfaceAction({
          type: 'setZoomIntent',
          filePath: identity.filePath,
          zoomIntent,
        }),
      rotationRequested: (direction) =>
        dispatchSurfaceAction({
          type: direction === 'clockwise' ? 'rotateClockwise' : 'rotateCounterClockwise',
          filePath: identity.filePath,
        }),
      viewModeRequested: (viewMode) =>
        dispatchSurfaceAction({
          type: 'setViewMode',
          filePath: identity.filePath,
          viewMode,
        }),
      linkTargetRequested: (target, actionOptions) =>
        dispatchSurfaceAction(
          {
            type: 'activateDocumentTarget',
            filePath: identity.filePath,
            target,
          },
          actionOptions,
        ),
    };
  };

  const presentSurface = (
    surface: DocumentSurface,
    identity: { filePath: string; title: string },
    surfaceId: string,
  ): PresentedDocument => {
    const originalGetState = surface.rendering.getState;
    surface.rendering.getState = () => ({
      ...originalGetState.call(surface.rendering),
      filePath: identity.filePath,
      fileName: identity.title,
    });
    return {
      identity,
      runtime: surface.runtime,
      id: surfaceId,
      title: identity.title,
      rendering: surface.rendering,
      presentation: {
        snapshot: () => surface.rendering.getState(),
        ...(surface.rendering.openSearch
          ? { openSearch: () => surface.rendering.openSearch?.() }
          : {}),
        setSearchQuery: (query) => surface.rendering.setSearchQuery(query),
        clearSearch: () => surface.rendering.clearSearch(),
        revealSearchMatch: (match) => surface.rendering.revealSearchMatch(match),
        addPageNote: (note) => surface.rendering.addPageNote(note),
        updateAnnotation: (id, updates) => surface.rendering.updateAnnotation(id, updates),
        removeAnnotation: (id) => surface.rendering.removeAnnotation(id),
      },
    };
  };

  const projection: ReaderProjection = {
    async prepareReloadDocument(documentState, actionOptions) {
      const previous = presented.get(documentState.filePath);
      const read = options.pdfSaveAdapter?.readSource;
      if (!previous || !read) throw new Error('Document reload is unavailable');
      const bytes = await read(documentState.filePath);
      if (actionOptions.isCancelled?.()) throw interruptionError();
      const identity = { filePath: documentState.filePath, title: documentState.title };
      const id = crypto.randomUUID();
      const surface = await createSurface({
        ...identity,
        bytes,
        callbacks: createCallbacks(identity, id),
      });
      try {
        surface.rendering.setVisible(false);
        await projectDocumentState(surface.rendering, documentState, actionOptions);
        if (actionOptions.isCancelled?.()) throw interruptionError();
        const replacement = presentSurface(surface, identity, id);
        return {
          runtime: surface.runtime,
          commit() {
            if (presented.get(identity.filePath) !== previous) throw interruptionError();
            surface.rendering.setVisible(visibleDocumentPath === identity.filePath);
            presented.set(identity.filePath, replacement);
            previous.rendering.destroy();
            renderDocumentControls(options.snapshot());
            options.renderingStateChanged?.();
          },
          async dispose() {
            await disposeSurface(surface);
          },
        };
      } catch (error) {
        await disposeSurface(surface);
        throw error;
      }
    },
    async verifySavedDocument(documentState, bytes, actionOptions) {
      const surface = await createSurface({
        filePath: documentState.filePath,
        title: documentState.title,
        bytes,
        callbacks: {
          readingPositionObserved() {},
          readingPositionSettled() {},
          stateChanged() {},
          pageNavigationRequested: async () => undefined,
          zoomIntentRequested: async () => undefined,
        },
      });
      try {
        surface.rendering.setVisible(false);
        if (actionOptions.isCancelled?.()) throw new Error('Save As preparation cancelled');
        await projectDocumentState(surface.rendering, documentState, actionOptions);
        if (actionOptions.isCancelled?.()) throw new Error('Save As preparation cancelled');
      } finally {
        await disposeSurface(surface);
      }
    },
    reidentifyDocument(filePath, destination) {
      const document = presented.get(filePath);
      if (!document || presented.has(destination.canonicalPath))
        throw new Error('Save As Document identity is stale');
      document.identity.filePath = destination.canonicalPath;
      document.identity.title = destination.title;
      presented.delete(filePath);
      presented.set(destination.canonicalPath, document);
      if (visibleDocumentPath === filePath) visibleDocumentPath = destination.canonicalPath;
    },
    activateDocument: activate,
    async closeDocument(filePath, nextActiveDocumentPath) {
      const documentState = presented.get(filePath);
      if (!documentState) return;
      if (documentState.runtime.editing?.state().dirty)
        throw new Error('This Document has unsaved native annotations');
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
    isOpen: options.isDocumentOpen,
    async activate(filePath, activateOptions) {
      const signal = activateOptions?.signal;
      await dispatchAcceptedIntakeActionOrThrow(
        { type: 'activateDocument', filePath },
        signal ? { isCancelled: () => signal.aborted } : undefined,
      );
      if (signal?.aborted) throw interruptionError();
      if (activateOptions?.notifyOpened !== false) {
        const documentState = options
          .snapshot()
          .documents.find((item) => item.filePath === filePath);
        if (documentState) await notifyDocumentOpened(filePath, documentState.title);
      }
    },
    async notifyOpened(filePath, operationOptions) {
      if (operationOptions?.signal?.aborted) throw interruptionError();
      const documentState = options.snapshot().documents.find((item) => item.filePath === filePath);
      if (!documentState) throw new Error(`Cannot notify for unopened Document: ${filePath}`);
      await notifyDocumentOpened(filePath, documentState.title);
    },
    async open(request: DocumentRuntimeOpenRequest) {
      const { document, bytes, initialPage, restoredDocument, signal } = request;
      const identity = { filePath: document.canonicalPath, title: document.title };
      const surfaceId = crypto.randomUUID();
      const callbacks = createCallbacks(identity, surfaceId);
      const surfaceWork = createSurface({
        filePath: document.canonicalPath,
        title: document.title,
        bytes,
        callbacks,
        ...(signal ? { signal } : {}),
      });
      const surface = await awaitAbortableWork(surfaceWork, {
        signal,
        abortError: interruptionError,
        onLateSuccess: async (lateSurface) => {
          const cleanupErrors = await disposeSurface(lateSurface);
          for (const cleanupError of cleanupErrors) {
            console.error('Late Document Intake cleanup failed:', cleanupError);
          }
        },
      });
      presented.set(document.canonicalPath, presentSurface(surface, identity, surfaceId));
      surface.rendering.setVisible(false);

      const initialDocument: ReadingSessionDocument = restoredDocument
        ? {
            ...restoredDocument,
            filePath: document.canonicalPath,
            title: document.title,
            visualState: restoredDocument.visualState ?? options.defaultVisualState(),
          }
        : {
            filePath: document.canonicalPath,
            title: document.title,
            readingPosition: { page: initialPage ?? 1, location: 0 },
            visualState: options.defaultVisualState(),
          };
      try {
        await awaitAbortableWork(projectDocumentState(surface.rendering, initialDocument), {
          signal,
          abortError: interruptionError,
        });
        if (signal?.aborted) throw interruptionError();
        await dispatchAcceptedIntakeActionOrThrow(
          {
            type: 'registerDocument',
            document: initialDocument,
            runtime: surface.runtime,
            activate: request.activate,
            ...(initialPage !== undefined
              ? { readingPosition: surface.rendering.getReadingPosition() }
              : {}),
          },
          signal ? { isCancelled: () => signal.aborted } : undefined,
        );
      } catch (error) {
        presented.delete(document.canonicalPath);
        const cleanupErrors = await disposeSurface(surface);
        if (cleanupErrors.length > 0) {
          throw new AggregateError([error, ...cleanupErrors], 'Document Intake cleanup failed');
        }
        throw error;
      }
      if (request.notifyOpened !== false) {
        await notifyDocumentOpened(document.canonicalPath, document.title);
      }
      debugLog(`Prepared Document surface: ${document.title}`);
    },
    async goToPage(filePath, page, operationOptions) {
      const signal = operationOptions?.signal;
      await dispatchAcceptedIntakeActionOrThrow(
        { type: 'goToPage', filePath, page },
        signal ? { isCancelled: () => signal.aborted } : undefined,
      );
    },
    async restoreExistingDocument(filePath, documentState, { preserveReadingPosition, signal }) {
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
        const actionOptions = signal ? { isCancelled: () => signal.aborted } : undefined;
        await awaitAbortableWork(projectDocumentState(rendering, restoredDocument, actionOptions), {
          signal,
          abortError: interruptionError,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
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
      const presentation = presented.get(query.filePath)?.presentation;
      return presentation ? { query, presentation } : null;
    },
    activePresentation() {
      const filePath = options.snapshot().activeDocumentPath;
      const rendering = filePath ? presented.get(filePath)?.rendering : null;
      return rendering
        ? {
            snapshot: () => rendering.getState(),
            setViewMode: (viewMode) => rendering.setViewMode(viewMode),
            fitToPage: () => rendering.fitToPage(),
            setZoomIntent: (zoomIntent) => rendering.setZoomIntent(zoomIntent),
          }
        : null;
    },
    activeRenderingState() {
      const filePath = options.snapshot().activeDocumentPath;
      return filePath ? (presented.get(filePath)?.rendering.getState() ?? null) : null;
    },
    activeReadingPosition() {
      const filePath = options.snapshot().activeDocumentPath;
      const rendering = filePath ? presented.get(filePath)?.rendering : null;
      return filePath && rendering
        ? { filePath, readingPosition: rendering.getReadingPosition() }
        : null;
    },
    viewTransform(filePath) {
      const state = presented.get(filePath)?.rendering.getState();
      const visualState = options
        .snapshot()
        .documents.find((item) => item.filePath === filePath)?.visualState;
      if (!state || !visualState) return null;
      return {
        scale: state.zoom,
        zoomIntent: cloneZoomIntent(state.zoomIntent),
        viewingRotation: state.rotation,
        viewMode: state.viewMode,
        filterCss: buildFilterCSS(visualState.filterSettings),
      };
    },
    replaceAnnotations(filePath) {
      for (const [path, documentState] of presented) {
        if (filePath !== null && path !== filePath) continue;
        documentState.rendering.setAnnotations(annotationAuthority.snapshot(path));
      }
    },
  };
}
