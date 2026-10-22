import type { Rect } from '@embedpdf/models';
import EmbedPDF, {
  type AnnotationCapability,
  type CommandsCapability,
  type DocumentManagerCapability,
  type HistoryCapability,
  type PdfAnnotationObject,
  type PluginRegistry,
  type Rotation,
  type ScrollCapability,
  ScrollStrategy,
  type SelectionCapability,
  type SpreadCapability,
  SpreadMode,
  type ThumbnailCapability,
  type ViewportCapability,
  type ZoomCapability,
  ZoomMode,
} from '@embedpdf/snippet';
import type {
  PdfOutlineItem,
  PdfSearchMatch,
  SearchProgress,
  ViewMode,
} from '../lib/document-features';
import { isEditableTarget } from '../lib/editable-target';
import type { PdfLinkTarget } from '../lib/pdf-links';
import type {
  DocumentContentMetadata,
  PdfPasswordRequester,
  ResolvedDocumentLinkTarget,
} from '../reader/document-content';
import type { DocumentAnnotationSnapshot } from '../reader/document-queries';
import type {
  AnnotationEdit,
  AnnotationToolDefaults,
  SelectedAnnotation,
} from '../reader/document-rendering';
import type { AnnotationDisplayName, NativePdfEditing } from '../reader/native-pdf-editing';
import type {
  ReadingPosition,
  RestorableReadingPosition,
  ZoomIntent,
} from '../reader/reader-actions';
import type { DocumentSurfaceCallbacks } from './document-workspace';
import { createEmbedPdfNativeAnnotationEditing } from './embedpdf-native-annotation-editing';
import {
  captureEmbedPdfReadingPosition,
  EMBEDPDF_VIEWPORT_SELECTOR,
  embedPdfAnnotationSnapshots,
  embedPdfDestinationReadingPosition,
  embedPdfLayoutForViewMode,
  embedPdfLinkGeometries,
  embedPdfLinkTarget,
  embedPdfLinkTargetAtGeometry,
  embedPdfPageNumberForEventPath,
  embedPdfReadingFilterStyle,
  embedPdfSearchHitLocation,
  embedPdfZoomLevelFromIntent,
  isEmbedPdfLinkHitArea,
  restoreEmbedPdfReadingPositionCoordinates,
  viewModeForEmbedPdfLayout,
  zoomIntentFromEmbedPdfLevel,
} from './embedpdf-navigation-geometry';
import {
  createEmbedPdfViewerConfig,
  preloadEmbedPdfLocalFonts,
} from './embedpdf-offline-configuration';
import { prepareEmbedPdfPrintDocument } from './embedpdf-print-preparation';
import { installInkSelectionGeometry } from './embedpdf-selection-geometry';
import { monightOwnsEmbedPdfCommand, removeEmbedPdfCommandShortcuts } from './embedpdf-shortcuts';

interface EmbedPdfOpenRequest {
  readonly bytes: Uint8Array;
  readonly title: string;
  readonly filePath: string;
  readonly signal?: AbortSignal;
}

interface CreateEmbedPdfViewerRequest {
  readonly readOnlyReason?: string | null;
  readonly annotationDisplayName: AnnotationDisplayName;
  readonly target: HTMLElement;
  readonly callbacks: DocumentSurfaceCallbacks;
  readonly requestPassword?: PdfPasswordRequester;
}

export interface EmbedPdfViewerRuntime {
  readonly editing?: NativePdfEditing;
  preparePrintDocument(): Promise<Uint8Array>;
  open(request: EmbedPdfOpenRequest): Promise<void>;
  activeAnnotationTool(): string | null;
  setActiveAnnotationTool(toolId: string | null, defaults?: AnnotationToolDefaults): void;
  /** Marks the text selection with a text-markup tool; false when nothing is selected. */
  markupSelection(toolId: string, defaults: AnnotationToolDefaults): boolean;
  pageCount(): number;
  /** Each page's live Page Rotation (quarter turns), in page order. */
  pageRotations(): readonly number[];
  currentPage(): number;
  currentZoom(): number;
  zoomIntent(): ZoomIntent;
  viewMode(): ViewMode;
  readingPosition(): ReadingPosition;
  goToPage(pageNumber: number): Promise<void>;
  goToReadingPosition(position: RestorableReadingPosition): Promise<void>;
  setZoomIntent(intent: ZoomIntent): Promise<void>;
  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  setViewMode(viewMode: ViewMode): Promise<void>;
  fitToPage(): Promise<void>;
  applyFilter(filterCss: string): void;
  setVisible(visible: boolean): void;
  search(
    query: string,
    options: { isCancelled: () => boolean; onProgress?: (progress: SearchProgress) => void },
  ): Promise<readonly PdfSearchMatch[]>;
  outline(options: { isCancelled: () => boolean }): Promise<readonly PdfOutlineItem[]>;
  metadata(options: { isCancelled: () => boolean }): Promise<DocumentContentMetadata | null>;
  resolveLinkTarget(
    target: PdfLinkTarget,
    options: { isCancelled: () => boolean },
  ): Promise<ResolvedDocumentLinkTarget | null>;
  renderThumbnail(pageNumber: number, maxWidth?: number): Promise<HTMLCanvasElement>;
  /** Live text-markup and note Annotations of any author. */
  annotations(): readonly DocumentAnnotationSnapshot[];
  /** Selects an Annotation, so Monight's annotation menu opens beside it. */
  revealAnnotation(annotationId: string): void;
  /** The single selected Annotation and where it sits in the window; null when none. */
  selectedAnnotation(): SelectedAnnotation | null;
  /** Edits an Annotation (an unsaved, undoable edit); false when there is no such Annotation. */
  editAnnotation(annotationId: string, edit: AnnotationEdit): boolean;
  destroy(): Promise<void>;
}

const requireCapability = <T>(registry: PluginRegistry, pluginId: string): T => {
  const capability = registry.getPlugin(pluginId)?.provides?.() as T | undefined;
  if (!capability) throw new Error(`EmbedPDF ${pluginId} capability is unavailable`);
  return capability;
};

const isPasswordError = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'reason' in error &&
      typeof error.reason === 'object' &&
      error.reason !== null &&
      'code' in error.reason &&
      error.reason.code === 4,
  );

const searchExcerpt = (context: {
  before: string;
  match: string;
  after: string;
  truncatedLeft: boolean;
  truncatedRight: boolean;
}): string =>
  `${context.truncatedLeft ? '…' : ''}${context.before}${context.match}${context.after}${
    context.truncatedRight ? '…' : ''
  }`
    .replace(/\s+/g, ' ')
    .trim();

const createSearchMatch = (
  result: {
    readonly charIndex: number;
    readonly context: Parameters<typeof searchExcerpt>[0];
    readonly rects?: Parameters<typeof embedPdfSearchHitLocation>[2];
  },
  pageNumber: number,
  pageOccurrence: number,
  page:
    | { readonly size: { width: number; height: number }; readonly rotation?: Rotation }
    | undefined,
): PdfSearchMatch => ({
  pageNumber,
  pageOccurrence,
  index: result.charIndex,
  excerpt: searchExcerpt(result.context),
  ...(page && result.rects
    ? { location: embedPdfSearchHitLocation(page.size, page.rotation ?? 0, result.rects) }
    : {}),
});

async function blobToCanvas(blob: Blob, maxWidth?: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const scale = maxWidth && bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

const waitForPresentationFrames = async (): Promise<void> => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

export async function createEmbedPdfViewerRuntime({
  target,
  callbacks,
  requestPassword,
  readOnlyReason = 'Native editing safety inspection is unavailable',
  annotationDisplayName,
}: CreateEmbedPdfViewerRequest): Promise<EmbedPdfViewerRuntime> {
  const fonts = await preloadEmbedPdfLocalFonts();
  const container = EmbedPDF.init({
    type: 'container',
    target,
    ...createEmbedPdfViewerConfig(
      (fontPath) => fonts.get(fontPath) ?? null,
      readOnlyReason === null,
      annotationDisplayName,
    ),
  });
  if (!container) throw new Error('EmbedPDF did not create a viewer container');
  const registry = await container.registry;
  await registry.pluginsReady();
  const documentManager = requireCapability<DocumentManagerCapability>(
    registry,
    'document-manager',
  );
  const commands = requireCapability<CommandsCapability>(registry, 'commands');
  const configuredCommands = new Set<string>();
  for (const [shortcut, commandId] of [...commands.getAllShortcuts()]) {
    if (configuredCommands.has(commandId)) continue;
    configuredCommands.add(commandId);
    if (monightOwnsEmbedPdfCommand(commandId)) {
      removeEmbedPdfCommandShortcuts(commands, commandId, [shortcut]);
    } else {
      const original = commands.getCommandByShortcut(shortcut);
      if (!original) continue;
      commands.unregisterCommand(original.id);
      commands.registerCommand({
        ...original,
        action: (context) => {
          if (target.dataset.visible === 'true' && !target.closest('[inert]'))
            original.action(context);
        },
      });
    }
  }
  const annotations = requireCapability<AnnotationCapability>(registry, 'annotation');
  const scroll = requireCapability<ScrollCapability>(registry, 'scroll');
  const zoom = requireCapability<ZoomCapability>(registry, 'zoom');
  const spread = requireCapability<SpreadCapability>(registry, 'spread');
  const thumbnails = requireCapability<ThumbnailCapability>(registry, 'thumbnail');
  const viewport = requireCapability<ViewportCapability>(registry, 'viewport');
  const engine = registry.getEngine();
  installInkSelectionGeometry(engine);
  const unsubscribers: Array<() => void> = [];
  const documentId = `monight-${crypto.randomUUID()}`;
  let sourceBytes = new Uint8Array();
  let fileName = '';
  let documentObject: ReturnType<DocumentManagerCapability['getDocument']> = null;
  let selectedViewMode: ViewMode = 'single';
  let selectedScrollStrategy = ScrollStrategy.Vertical;
  let selectedSpreadMode = SpreadMode.None;
  let destroyed = false;
  let pendingObservedPosition: ReadingPosition | null = null;
  let readingAnchor: ReadingPosition | null = null;
  let selectedZoomIntent: ZoomIntent | null = null;
  let layoutEpoch = 0;
  let observationEpoch = 0;
  const projectionDepth = { page: 0, zoom: 0, viewMode: 0 };
  let initialLayoutReady = false;
  let resolveInitialLayout!: () => void;
  const initialLayoutReadyPromise = new Promise<void>((resolve) => {
    resolveInitialLayout = resolve;
  });

  const currentDocument = () => {
    if (!documentObject) throw new Error('EmbedPDF Document Content is not loaded');
    return documentObject;
  };
  const scrollScope = scroll.forDocument(documentId);
  const annotationScope = annotations.forDocument(documentId);
  const selectionScope = requireCapability<SelectionCapability>(registry, 'selection').forDocument(
    documentId,
  );
  const spreadScope = spread.forDocument(documentId);
  const thumbnailScope = thumbnails.forDocument(documentId);
  const zoomScope = zoom.forDocument(documentId);
  const store = registry.getStore();
  const historyScope = requireCapability<HistoryCapability>(registry, 'history').forDocument(
    documentId,
  );
  const { editing, onAnnotationEvent } = createEmbedPdfNativeAnnotationEditing({
    annotations,
    annotationScope,
    currentDocument,
    engine,
    history: historyScope,
    pageRotationChanged(pageIndexes) {
      // Keep the viewer's copy of each page in step, then re-lay out (SET_ROTATION with
      // the unchanged view rotation) and re-render the turned pages.
      const core = store.getState().core.documents[documentId];
      const live = currentDocument();
      for (const index of pageIndexes) {
        const page = core?.document?.pages[index];
        const rotation = live.pages[index]?.rotation;
        if (page && rotation !== undefined) page.rotation = rotation;
      }
      store.dispatch({
        type: 'SET_ROTATION',
        payload: { rotation: core?.rotation ?? 0, documentId },
      });
      store.dispatch({
        type: 'REFRESH_PAGES',
        payload: { documentId, pageIndexes: [...pageIndexes] },
      });
      for (const index of pageIndexes) annotationScope.invalidatePageAppearances(index);
    },
    readOnlyReason,
    stateChanged: callbacks.stateChanged,
  });
  unsubscribers.push(
    annotationScope.onAnnotationEvent(onAnnotationEvent),
    // Edit ▸ Undo and Redo follow whether there is an edit to undo or redo.
    historyScope.onHistoryChange(() => {
      if (!destroyed) callbacks.stateChanged();
    }),
    // Edits already report a state change; loading the PDF's Annotations must too,
    // so listings such as Highlights and Notes see them once they arrive.
    annotationScope.onAnnotationEvent((event) => {
      if (event.type === 'loaded' && !destroyed) callbacks.stateChanged();
    }),
  );
  const currentPageNumber = () => scrollScope.getCurrentPage();
  const currentReadingPosition = (metrics = scrollScope.getMetrics()): ReadingPosition =>
    captureEmbedPdfReadingPosition(
      currentPageNumber(),
      metrics,
      scrollScope.getLayout(),
      viewport.getViewportGap() / zoomScope.getState().currentZoomLevel,
    );
  const publishViewModeFromLayout = (
    nextViewMode = viewModeForEmbedPdfLayout(selectedScrollStrategy, selectedSpreadMode),
  ): void => {
    const changed = nextViewMode !== selectedViewMode;
    selectedViewMode = nextViewMode;
    callbacks.stateChanged();
    // Projection sets selectedViewMode before emitting layout changes, so only
    // a distinct viewer choice reaches this path, even during a previous render.
    if (changed) {
      void callbacks.viewModeRequested?.(nextViewMode);
    }
  };
  const linkTargetForEvent = (event: Event): ReturnType<typeof embedPdfLinkTargetAtGeometry> => {
    const path = event.composedPath();
    if (!path.some((target) => target instanceof Element && isEmbedPdfLinkHitArea(target))) {
      return null;
    }
    const pageNumber = embedPdfPageNumberForEventPath(
      path,
      scrollScope.getLayout(),
      scrollScope.getMetrics().renderedPageIndexes,
    );
    if (pageNumber === null) return null;
    return embedPdfLinkTargetAtGeometry(
      annotationScope.getAnnotations(),
      embedPdfLinkGeometries(path),
      zoomScope.getState().currentZoomLevel,
      pageNumber,
    );
  };
  const monightLinkTarget = (target: Parameters<typeof embedPdfLinkTarget>[0]) =>
    embedPdfLinkTarget(target, (destination) => {
      const page = currentDocument().pages[destination.pageIndex];
      return embedPdfDestinationReadingPosition(
        destination,
        currentDocument().pageCount,
        page?.size.height ?? 0,
      );
    });
  const requestLinkTarget = async (
    target: NonNullable<ReturnType<typeof embedPdfLinkTargetAtGeometry>>,
  ): Promise<void> => {
    if (destroyed) return;
    const monightTarget = monightLinkTarget(target);
    if (!monightTarget || !callbacks.linkTargetRequested) return;
    await callbacks.linkTargetRequested(monightTarget);
  };
  const interceptEmbedPdfLink = (event: Event): void => {
    const target = linkTargetForEvent(event);
    if (!target) return;
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    event.preventDefault();
    void requestLinkTarget(target).catch((error) => {
      console.error('Failed to activate EmbedPDF link:', error);
    });
  };
  const shadowRoot = container.shadowRoot;
  if (!shadowRoot) throw new Error('EmbedPDF viewer shadow root is unavailable');
  const readingStyle = document.createElement('style');
  readingStyle.textContent = embedPdfReadingFilterStyle();
  shadowRoot.append(readingStyle);
  shadowRoot.addEventListener('pointerdown', interceptEmbedPdfLink, { capture: true });
  shadowRoot.addEventListener('click', interceptEmbedPdfLink, { capture: true });
  unsubscribers.push(
    () => shadowRoot.removeEventListener('pointerdown', interceptEmbedPdfLink, { capture: true }),
    () => shadowRoot.removeEventListener('click', interceptEmbedPdfLink, { capture: true }),
  );

  // Edit ▸ Copy copies the page text selection, as ⌘C (EmbedPDF's own shortcut) does.
  const copyTextSelection = (event: ClipboardEvent) => {
    if (destroyed || target.dataset.visible !== 'true' || target.closest('[inert]')) return;
    if (isEditableTarget(document.activeElement) || !selectionScope.getState().selection) return;
    event.preventDefault();
    selectionScope.copyToClipboard();
  };
  document.addEventListener('copy', copyTextSelection);
  unsubscribers.push(() => document.removeEventListener('copy', copyTextSelection));

  // Where an Annotation sits in the window, for Monight's annotation menu; null
  // while it is scrolled out of the viewer.
  const annotationAnchor = (object: { pageIndex: number; rect: Rect }) => {
    const viewportElement = shadowRoot.querySelector(EMBEDPDF_VIEWPORT_SELECTOR);
    const pages = viewportElement?.firstElementChild;
    const position = scrollScope.getRectPositionForPage(object.pageIndex, object.rect);
    if (!viewportElement || !pages || !position) return null;
    const content = pages.getBoundingClientRect();
    const visible = viewportElement.getBoundingClientRect();
    const anchor = {
      left: content.left + position.origin.x,
      top: content.top + position.origin.y,
      width: position.size.width,
      height: position.size.height,
    };
    const inView =
      anchor.top + anchor.height > visible.top &&
      anchor.top < visible.bottom &&
      anchor.left + anchor.width > visible.left &&
      anchor.left < visible.right;
    return inView ? anchor : null;
  };
  let selectedAnnotationIds = '';
  unsubscribers.push(
    // Monight's annotation menu follows the selection.
    annotationScope.onStateChange((state) => {
      const ids = state.selectedUids.join('\n');
      if (destroyed || ids === selectedAnnotationIds) return;
      selectedAnnotationIds = ids;
      callbacks.stateChanged();
    }),
    annotationScope.onActiveToolChange(() => callbacks.stateChanged()),
    scroll.onPageChange((event) => {
      if (event.documentId !== documentId) return;
      callbacks.stateChanged();
      // This reports movement that already happened (including search/thumbnails
      // and ordinary scrolling). onScroll settles its precise Reading Position;
      // requesting another page jump here would reset the within-page location.
    }),
    scrollScope.onScroll((metrics) => {
      if (destroyed) return;
      callbacks.stateChanged();
      if (Object.values(projectionDepth).some((depth) => depth > 0)) return;
      const epoch = ++observationEpoch;
      const position = currentReadingPosition(metrics);
      // Layout changes emit intermediate metrics synchronously, before the zoom
      // notification. Give that notification time to cancel the sample.
      void waitForPresentationFrames().then(() => {
        if (
          destroyed ||
          epoch !== observationEpoch ||
          Object.values(projectionDepth).some((depth) => depth > 0)
        )
          return;
        pendingObservedPosition = position;
        readingAnchor = position;
        callbacks.readingPositionObserved(position);
      });
    }),
    scroll.onLayoutReady((event) => {
      if (event.documentId !== documentId || !event.isInitial || initialLayoutReady) return;
      initialLayoutReady = true;
      resolveInitialLayout();
    }),
    scroll.onStateChange((state) => {
      if (state.strategy === selectedScrollStrategy) return;
      selectedScrollStrategy = state.strategy;
      publishViewModeFromLayout(
        state.strategy === ScrollStrategy.Vertical
          ? 'continuous'
          : viewModeForEmbedPdfLayout(state.strategy, selectedSpreadMode),
      );
    }),
    viewport.onScrollActivity((event) => {
      if (
        event.documentId === documentId &&
        !event.activity.isScrolling &&
        !event.activity.isSmoothScrolling &&
        pendingObservedPosition
      ) {
        callbacks.readingPositionSettled(pendingObservedPosition);
        pendingObservedPosition = null;
      }
    }),
    zoom.onZoomChange((event) => {
      if (destroyed || event.documentId !== documentId) return;
      callbacks.stateChanged();
      // Relative zoom events carry the old numeric level plus the resulting
      // actual scale. Fit modes keep their symbolic intent across recalculation.
      const intent = zoomIntentFromEmbedPdfLevel(
        typeof event.level === 'number' ? event.newZoom : event.level,
      );
      const changed = JSON.stringify(intent) !== JSON.stringify(selectedZoomIntent);
      selectedZoomIntent = intent;
      if (projectionDepth.zoom === 0 && changed) void callbacks.zoomIntentRequested(intent);
      else if (projectionDepth.zoom === 0 && intent.kind !== 'manual' && readingAnchor) {
        // EmbedPDF recalculates fit asynchronously after a resize. Its pixel
        // anchor can drift across page gaps; restore Monight's normalized anchor.
        const anchor = { ...readingAnchor };
        void withProjection('page', () => scrollToPosition(anchor));
      }
    }),
    spread.onSpreadChange((event) => {
      if (event.documentId !== documentId) return;
      if (event.spreadMode === selectedSpreadMode) return;
      selectedSpreadMode = event.spreadMode;
      publishViewModeFromLayout();
    }),
  );

  const scrollToPosition = (position: RestorableReadingPosition): void => {
    if (destroyed) return;
    readingAnchor = 'location' in position ? { ...position } : { page: position.page, location: 0 };
    const page = currentDocument().pages[position.page - 1];
    // Page Rotation is the only rotation; Monight never applies a view rotation.
    const rotation: Rotation = page?.rotation ?? 0;
    scrollScope.scrollToPage({
      pageNumber: position.page,
      pageCoordinates:
        page && 'location' in position
          ? restoreEmbedPdfReadingPositionCoordinates(page.size, rotation, position)
          : undefined,
      behavior: 'instant',
    });
  };
  const withProjection = async (
    kind: keyof typeof projectionDepth,
    work: () => void,
  ): Promise<void> => {
    if (destroyed) return;
    const epoch = ++layoutEpoch;
    observationEpoch += 1;
    const anchor = readingAnchor ?? currentReadingPosition();
    pendingObservedPosition = null;
    projectionDepth[kind] += 1;
    try {
      work();
      await waitForPresentationFrames();
      if (kind !== 'page' && !destroyed && epoch === layoutEpoch) {
        scrollToPosition(anchor);
        await waitForPresentationFrames();
      }
    } finally {
      projectionDepth[kind] -= 1;
    }
  };
  unsubscribers.push(
    viewport.onViewportResize((event) => {
      if (destroyed || !documentObject || event.documentId !== documentId || !readingAnchor) return;
      const anchor = { ...readingAnchor };
      void withProjection('page', () => scrollToPosition(anchor));
    }),
  );

  const openDocument = async (password?: string) => {
    const response = await documentManager
      .openDocumentBuffer({
        buffer: sourceBytes.slice().buffer,
        name: fileName,
        documentId,
        autoActivate: true,
        ...(password ? { password } : {}),
      })
      .toPromise();
    return response.task.toPromise();
  };

  const waitForInitialLayout = async (signal?: AbortSignal): Promise<void> => {
    if (!initialLayoutReady) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new Error('Document Intake interrupted'));
        signal?.addEventListener('abort', abort, { once: true });
        void initialLayoutReadyPromise.then(() => {
          signal?.removeEventListener('abort', abort);
          resolve();
        });
      });
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  };

  return {
    editing,
    preparePrintDocument: () =>
      prepareEmbedPdfPrintDocument({
        document: currentDocument(),
        editing,
        engine,
        readOnlyReason,
      }),
    async open(request) {
      if (request.signal?.aborted) throw new Error('Document Intake interrupted');
      sourceBytes = request.bytes.slice();
      fileName = request.title;
      try {
        documentObject = await openDocument();
      } catch (error) {
        if (!isPasswordError(error) || !requestPassword) throw error;
        let passwordError: unknown = error;
        let reason: 'required' | 'incorrect' = 'required';
        while (isPasswordError(passwordError)) {
          if (request.signal?.aborted) throw new Error('Document Intake interrupted');
          const password = await requestPassword(fileName, reason, request.signal);
          if (password === null) throw new Error('Password entry cancelled');
          if (request.signal?.aborted) throw new Error('Document Intake interrupted');
          try {
            const retry = await documentManager.retryDocument(documentId, { password }).toPromise();
            documentObject = await retry.task.toPromise();
            break;
          } catch (retryError) {
            passwordError = retryError;
            reason = 'incorrect';
          }
        }
        if (!documentObject) throw passwordError;
      }
      if (request.signal?.aborted) throw new Error('Document Intake interrupted');
      if (!documentObject) documentObject = documentManager.getDocument(documentId);
      if (!documentObject) throw new Error('EmbedPDF did not publish the opened Document');
      await waitForInitialLayout(request.signal);
      if (request.signal?.aborted) throw new Error('Document Intake interrupted');
    },
    activeAnnotationTool: () => annotationScope.getActiveTool()?.id ?? null,
    setActiveAnnotationTool(toolId, defaults) {
      if (destroyed) return;
      if (toolId !== null && defaults) annotations.setToolDefaults(toolId, { ...defaults });
      annotationScope.setActiveTool(toolId);
    },
    markupSelection(toolId, defaults) {
      if (destroyed || readOnlyReason !== null) return false;
      const tool = annotations.getTool(toolId);
      const segments = selectionScope.getFormattedSelection();
      if (!tool?.interaction.textSelection || segments.length === 0) return false;
      annotations.setToolDefaults(toolId, { ...defaults });
      const toolDefaults = annotations.getTool(toolId)?.defaults ?? tool.defaults;
      // As EmbedPDF's own text-markup tools do: one native markup per page, with
      // the marked text kept alongside for listings such as Highlights and Notes.
      const text = new Promise<string | undefined>((resolve) =>
        selectionScope.getSelectedText().wait(
          (lines) => resolve(lines.join('\n')),
          () => resolve(undefined),
        ),
      );
      for (const segment of segments) {
        const id = crypto.randomUUID();
        void text.then((selectedText) => {
          if (destroyed) return;
          annotationScope.createAnnotation(segment.pageIndex, {
            ...toolDefaults,
            rect: segment.rect,
            segmentRects: segment.segmentRects,
            pageIndex: segment.pageIndex,
            created: new Date(),
            id,
            ...(selectedText != null ? { custom: { text: selectedText } } : {}),
          } as PdfAnnotationObject);
        });
      }
      selectionScope.clear();
      return true;
    },
    pageCount: () => documentObject?.pageCount ?? 0,
    pageRotations: () => documentObject?.pages.map(({ rotation }) => rotation) ?? [],
    currentPage: currentPageNumber,
    currentZoom: () => zoomScope.getState().currentZoomLevel,
    zoomIntent: () => zoomIntentFromEmbedPdfLevel(zoomScope.getState().zoomLevel),
    viewMode: () => selectedViewMode,
    readingPosition: currentReadingPosition,
    goToPage: (pageNumber) =>
      withProjection('page', () => scrollToPosition({ page: pageNumber, location: 0 })),
    goToReadingPosition: (position) => withProjection('page', () => scrollToPosition(position)),
    setZoomIntent: (intent) => {
      // A viewer interaction has already applied its zoom (including its gesture
      // focal point). Committing that intent must not execute the zoom a second time.
      if (
        JSON.stringify(intent) ===
        JSON.stringify(zoomIntentFromEmbedPdfLevel(zoomScope.getState().zoomLevel))
      )
        return Promise.resolve();
      return withProjection('zoom', () =>
        zoomScope.requestZoom(embedPdfZoomLevelFromIntent(intent)),
      );
    },
    zoomIn: () => withProjection('zoom', () => zoomScope.zoomIn()),
    zoomOut: () => withProjection('zoom', () => zoomScope.zoomOut()),
    setViewMode: (viewMode) =>
      withProjection('viewMode', () => {
        const layout = embedPdfLayoutForViewMode(viewMode);
        selectedViewMode = viewMode;
        selectedScrollStrategy = layout.scrollStrategy;
        selectedSpreadMode = layout.spreadMode;
        scrollScope.setScrollStrategy(layout.scrollStrategy);
        spreadScope.setSpreadMode(layout.spreadMode);
      }),
    fitToPage: () => withProjection('zoom', () => zoomScope.requestZoom(ZoomMode.FitPage)),
    applyFilter(filterCss) {
      container.style.setProperty('--monight-reading-filter', filterCss);
    },
    setVisible(visible) {
      target.dataset.visible = String(visible);
    },
    async search(query, options) {
      if (options.isCancelled() || !query.trim()) return [];
      // Document Queries must not activate search, select a result, or cancel the
      // reader's interactive search. The engine query has no viewer state effects.
      const task = engine.searchAllPages(currentDocument(), query);
      const progressMatches: PdfSearchMatch[] = [];
      const pageOccurrences = new Map<number, number>();
      task.onProgress(({ page, results }) => {
        if (options.isCancelled()) return;
        const pageMatches = results.map((result) => {
          const pageNumber = page + 1;
          const pageOccurrence = pageOccurrences.get(pageNumber) ?? 0;
          pageOccurrences.set(pageNumber, pageOccurrence + 1);
          return createSearchMatch(
            result,
            pageNumber,
            pageOccurrence,
            currentDocument().pages[page],
          );
        });
        progressMatches.push(...pageMatches);
        options.onProgress?.({
          pageNumber: page + 1,
          totalPages: currentDocument().pageCount,
          pageMatches: pageMatches.map((match) => ({ ...match })),
          matches: progressMatches.map((match) => ({ ...match })),
        });
      });
      const result = await task.toPromise();
      if (options.isCancelled()) return [];
      const occurrences = new Map<number, number>();
      return result.results.map((match) => {
        const pageNumber = match.pageIndex + 1;
        const pageOccurrence = occurrences.get(pageNumber) ?? 0;
        occurrences.set(pageNumber, pageOccurrence + 1);
        return createSearchMatch(
          match,
          pageNumber,
          pageOccurrence,
          currentDocument().pages[match.pageIndex],
        );
      });
    },
    async outline(options) {
      if (options.isCancelled()) return [];
      const bookmarks = await engine.getBookmarks(currentDocument()).toPromise();
      const mapBookmark = (bookmark: {
        title: string;
        target?: unknown;
        children?: unknown[];
      }): PdfOutlineItem => {
        const target = bookmark.target as
          | {
              type?: string;
              destination?: { pageIndex?: number };
              action?: { uri?: string; destination?: { pageIndex?: number } };
            }
          | undefined;
        const pageIndex =
          target?.type === 'destination'
            ? target.destination?.pageIndex
            : target?.action?.destination?.pageIndex;
        const linkTarget = bookmark.target
          ? monightLinkTarget(bookmark.target as Parameters<typeof monightLinkTarget>[0])
          : null;
        return {
          title: bookmark.title,
          pageNumber: typeof pageIndex === 'number' ? pageIndex + 1 : null,
          ...(target?.action?.uri ? { url: target.action.uri } : {}),
          ...(linkTarget ? { target: linkTarget } : {}),
          bold: false,
          italic: false,
          items: (bookmark.children ?? []).map((child) =>
            mapBookmark(child as Parameters<typeof mapBookmark>[0]),
          ),
        };
      };
      return options.isCancelled() ? [] : bookmarks.bookmarks.map(mapBookmark);
    },
    async metadata(options) {
      if (options.isCancelled()) return null;
      const metadata = await engine.getMetadata(currentDocument()).toPromise();
      return options.isCancelled()
        ? null
        : {
            title: metadata.title,
            author: metadata.author,
            subject: metadata.subject,
            keywords: metadata.keywords
              ? metadata.keywords
                  .split(/[;,]/)
                  .map((keyword) => keyword.trim())
                  .filter(Boolean)
              : [],
            pageCount: currentDocument().pageCount,
          };
    },
    async resolveLinkTarget(target, options) {
      if (options.isCancelled()) return null;
      if (target.url) return { kind: 'external', url: target.url };
      if (target.readingPosition) {
        return {
          kind: 'page',
          pageNumber: target.readingPosition.page,
          location: target.readingPosition.location,
        };
      }
      return null;
    },
    async renderThumbnail(pageNumber, maxWidth) {
      const blob = await thumbnailScope
        .renderThumb(pageNumber - 1, window.devicePixelRatio || 1)
        .toPromise();
      return blobToCanvas(blob, maxWidth);
    },
    annotations: () =>
      documentObject
        ? embedPdfAnnotationSnapshots(annotationScope.getAnnotations(), documentObject.pages)
        : [],
    revealAnnotation(annotationId) {
      if (destroyed) return;
      const annotation = annotationScope.getAnnotationById(annotationId);
      if (!annotation || annotation.commitState === 'deleted') return;
      annotationScope.selectAnnotation(annotation.object.pageIndex, annotationId);
    },
    selectedAnnotation() {
      if (destroyed || !documentObject) return null;
      const selected = annotationScope.getSelectedAnnotations();
      const [tracked] = selected;
      if (selected.length !== 1 || !tracked || tracked.commitState === 'deleted') return null;
      const [snapshot] = embedPdfAnnotationSnapshots([tracked], documentObject.pages);
      if (!snapshot) return null;
      return {
        id: snapshot.id,
        kind: snapshot.kind,
        contents: snapshot.contents,
        color: snapshot.color,
        anchor: annotationAnchor(tracked.object),
      };
    },
    editAnnotation(annotationId, edit) {
      if (destroyed || readOnlyReason !== null) return false;
      const annotation = annotationScope.getAnnotationById(annotationId);
      if (!annotation || annotation.commitState === 'deleted') return false;
      const { pageIndex } = annotation.object;
      if (edit.type === 'delete') annotationScope.deleteAnnotation(pageIndex, annotationId);
      else
        annotationScope.updateAnnotation(
          pageIndex,
          annotationId,
          edit.type === 'contents'
            ? { contents: edit.contents }
            : { strokeColor: edit.strokeColor },
        );
      return true;
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      try {
        if (documentManager.isDocumentOpen(documentId)) {
          await documentManager.closeDocument(documentId).toPromise();
        }
      } finally {
        await registry.destroy();
        container.remove();
      }
    },
  };
}
