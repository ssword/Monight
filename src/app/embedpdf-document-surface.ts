import EmbedPDF, {
  type AnnotationCapability,
  type CommandsCapability,
  type DocumentManagerCapability,
  type PDFViewerConfig,
  PdfAnnotationSubtype,
  type PdfLinkAnnoObject,
  type PluginRegistry,
  type RotateCapability,
  Rotation,
  type ScrollCapability,
  ScrollStrategy,
  type SearchCapability,
  type SpreadCapability,
  SpreadMode,
  type ThumbnailCapability,
  type TrackedAnnotation,
  type ViewportCapability,
  type ZoomCapability,
  type ZoomLevel,
  ZoomMode,
} from '@embedpdf/snippet';
import type {
  PdfAnnotation,
  PdfOutlineItem,
  PdfSearchMatch,
  SearchProgress,
  ViewMode,
} from '../lib/document-features';
import type { PdfLinkTarget } from '../lib/pdf-links';
import type {
  DocumentContent,
  DocumentContentMetadata,
  PdfPasswordRequester,
  ResolvedDocumentLinkTarget,
} from '../reader/document-content';
import type { DocumentRuntime } from '../reader/document-queries';
import type { DocumentRendering, DocumentRenderingState } from '../reader/document-rendering';
import { createInternalDocumentPage } from '../reader/internal-document-page';
import type {
  ReadingPosition,
  RestorableReadingPosition,
  ZoomIntent,
} from '../reader/reader-actions';
import type {
  DocumentSurface,
  DocumentSurfaceCallbacks,
  DocumentSurfaceFactory,
} from './document-workspace';

const EMBEDPDF_WASM_URL = '/embedpdf/pdfium.wasm';
const EMBEDPDF_FONT_BASE_URL = '/embedpdf/fonts';

const READ_ONLY_CATEGORIES = [
  'annotation',
  'redaction',
  'insert',
  'document-open',
  'document-close',
  'document-print',
  'document-export',
  'document-protect',
  'document-capture',
] as const;

const localFontFallback = {
  baseUrl: EMBEDPDF_FONT_BASE_URL,
  fonts: {
    0: 'NotoSans-Regular.ttf',
    1: 'NotoSans-Regular.ttf',
    128: 'NotoSansJP-Regular.otf',
    129: 'NotoSansKR-Regular.otf',
    134: 'NotoSansHans-Regular.otf',
    136: 'NotoSansHant-Regular.otf',
    161: 'NotoSans-Regular.ttf',
    163: 'NotoSans-Regular.ttf',
    177: 'NotoSansHebrew-Regular.ttf',
    178: 'NotoNaskhArabic-Regular.ttf',
    204: 'NotoSans-Regular.ttf',
    238: 'NotoSans-Regular.ttf',
  },
};

type LocalFontLoader = (fontPath: string) => Uint8Array | null;

const localFontUrls = [...new Set(Object.values(localFontFallback.fonts))].map(
  (fileName) => `${EMBEDPDF_FONT_BASE_URL}/${fileName}`,
);

let localFontData: Promise<Map<string, Uint8Array>> | null = null;

async function preloadLocalFonts(): Promise<Map<string, Uint8Array>> {
  localFontData ??= Promise.all(
    localFontUrls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`EmbedPDF font request failed: ${response.status} ${url}`);
      return [url, new Uint8Array(await response.arrayBuffer())] as const;
    }),
  ).then((entries) => new Map(entries));
  try {
    return await localFontData;
  } catch (error) {
    localFontData = null;
    throw error;
  }
}

export function createEmbedPdfViewerConfig(fontLoader?: LocalFontLoader): PDFViewerConfig {
  return {
    worker: false,
    wasmUrl: EMBEDPDF_WASM_URL,
    tabBar: 'never',
    fontFallback: {
      ...localFontFallback,
      ...(fontLoader ? { fontLoader } : {}),
    },
    stamp: { manifests: [], defaultLibrary: false },
    fonts: {
      ui: { family: 'system-ui, sans-serif', stylesheetUrl: null },
      signature: null,
    },
    disabledCategories: [...READ_ONLY_CATEGORIES],
    permissions: {
      enforceDocumentPermissions: true,
      overrides: {
        modifyContents: false,
        modifyAnnotations: false,
        fillForms: false,
        assembleDocument: false,
      },
    },
    render: { withAnnotations: true, withForms: false },
    annotations: { autoOpenLinks: false },
    form: { withForms: false, withAnnotations: true },
  };
}

interface EmbedPdfOpenRequest {
  readonly bytes: Uint8Array;
  readonly title: string;
  readonly filePath: string;
  readonly signal?: AbortSignal;
}

interface CreateEmbedPdfViewerRequest {
  readonly target: HTMLElement;
  readonly callbacks: DocumentSurfaceCallbacks;
  readonly requestPassword?: PdfPasswordRequester;
}

export interface EmbedPdfViewerRuntime {
  open(request: EmbedPdfOpenRequest): Promise<void>;
  openSearch(): void;
  pageCount(): number;
  currentPage(): number;
  currentZoom(): number;
  zoomIntent(): ZoomIntent;
  rotation(): number;
  viewMode(): ViewMode;
  readingPosition(): ReadingPosition;
  goToPage(pageNumber: number): Promise<void>;
  goToReadingPosition(position: RestorableReadingPosition): Promise<void>;
  setZoomIntent(intent: ZoomIntent): Promise<void>;
  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  setRotation(rotation: number): Promise<void>;
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
  destroy(): Promise<void>;
}

type EmbedPdfViewerFactory = (
  request: CreateEmbedPdfViewerRequest,
) => Promise<EmbedPdfViewerRuntime>;

const requireCapability = <T>(registry: PluginRegistry, pluginId: string): T => {
  const capability = registry.getPlugin(pluginId)?.provides?.() as T | undefined;
  if (!capability) throw new Error(`EmbedPDF ${pluginId} capability is unavailable`);
  return capability;
};

type EmbedPdfShortcutRegistry = Pick<
  CommandsCapability,
  'getCommandByShortcut' | 'registerCommand' | 'unregisterCommand'
>;

export function removeEmbedPdfCommandShortcuts(
  registry: EmbedPdfShortcutRegistry,
  commandId: string,
  shortcuts: readonly string[],
): void {
  const command = shortcuts
    .map((shortcut) => registry.getCommandByShortcut(shortcut))
    .find((candidate) => candidate?.id === commandId);
  if (!command) return;

  registry.unregisterCommand(commandId);
  registry.registerCommand({ ...command, shortcuts: undefined });
}

type EmbedPdfDestination = Extract<PdfLinkTarget['dest'], { readonly pageIndex: number }>;

interface EmbedPdfLinkTarget {
  readonly type: 'destination' | 'action';
  readonly destination?: EmbedPdfDestination;
  readonly action?: {
    readonly type: number;
    readonly uri?: string;
    readonly destination?: EmbedPdfDestination;
  };
}

interface EmbedPdfLinkGeometry {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function embedPdfLinkTarget(target: EmbedPdfLinkTarget): PdfLinkTarget | null {
  if (target.type === 'action' && target.action?.uri) return { url: target.action.uri };
  const destination =
    target.type === 'destination' ? target.destination : target.action?.destination;
  return destination ? { dest: destination } : null;
}

export function embedPdfDestinationReadingPosition(
  destination: EmbedPdfDestination,
  pageCount: number,
  pageHeight: number,
): ReadingPosition {
  const zoom = destination.zoom;
  const params = zoom && typeof zoom === 'object' && 'params' in zoom ? zoom.params : undefined;
  const y =
    params && typeof params === 'object' && 'y' in params && typeof params.y === 'number'
      ? params.y
      : undefined;
  return {
    page: Math.max(1, Math.min(destination.pageIndex + 1, pageCount)),
    location:
      typeof y === 'number' && pageHeight > 0
        ? Math.max(0, Math.min(1, (pageHeight - y) / pageHeight))
        : 0,
  };
}

const approximatelyEqual = (left: number, right: number, tolerance = 1.5): boolean =>
  Math.abs(left - right) <= tolerance;

const isEmbedPdfTrackedLink = (
  annotation: TrackedAnnotation,
): annotation is TrackedAnnotation<PdfLinkAnnoObject> =>
  annotation.object.type === PdfAnnotationSubtype.LINK;

export function embedPdfLinkTargetAtGeometry(
  annotations: readonly TrackedAnnotation[],
  geometries: readonly EmbedPdfLinkGeometry[],
  scale: number,
  currentPage: number,
): EmbedPdfLinkTarget | null {
  const matches = annotations.filter(isEmbedPdfTrackedLink).filter(({ object }) => {
    if (!object.target) return false;
    const sizeScale = object.flags?.includes('noZoom') ? 1 : scale;
    return geometries.some(
      (geometry) =>
        approximatelyEqual(geometry.left, object.rect.origin.x * scale) &&
        approximatelyEqual(geometry.top, object.rect.origin.y * scale) &&
        approximatelyEqual(geometry.width, object.rect.size.width * sizeScale) &&
        approximatelyEqual(geometry.height, object.rect.size.height * sizeScale),
    );
  });
  const match = matches.find(({ object }) => object.pageIndex + 1 === currentPage) ?? matches[0];
  return match?.object.target ?? null;
}

const isEmbedPdfLinkHitArea = (element: Element): boolean =>
  (element.tagName.toLowerCase() === 'rect' &&
    element.getAttribute('fill') === 'transparent' &&
    element.getAttribute('style')?.includes('cursor: pointer') === true &&
    element.getAttribute('style')?.includes('pointer-events: visible') === true) ||
  (element.tagName.toLowerCase() === 'div' &&
    element.getAttribute('style')?.includes('cursor: pointer') === true &&
    element.getAttribute('style')?.includes('pointer-events: auto') === true);

const embedPdfLinkGeometries = (path: readonly EventTarget[]): EmbedPdfLinkGeometry[] =>
  path.flatMap((target) => {
    if (!(target instanceof HTMLElement)) return [];
    const geometry = {
      left: Number.parseFloat(target.style.left),
      top: Number.parseFloat(target.style.top),
      width: Number.parseFloat(target.style.width),
      height: Number.parseFloat(target.style.height),
    };
    return Object.values(geometry).every(Number.isFinite) ? [geometry] : [];
  });

const zoomIntentFromLevel = (level: ZoomLevel): ZoomIntent => {
  if (typeof level === 'number') return { kind: 'manual', scale: level };
  return level === ZoomMode.FitWidth ? { kind: 'fit-width' } : { kind: 'fit-page' };
};

const zoomLevelFromIntent = (intent: ZoomIntent): ZoomLevel => {
  if (intent.kind === 'manual') return intent.scale;
  return intent.kind === 'fit-width' ? ZoomMode.FitWidth : ZoomMode.FitPage;
};

const rotationFromDegrees = (degrees: number): Rotation => {
  switch (((degrees % 360) + 360) % 360) {
    case 90:
      return Rotation.Degree90;
    case 180:
      return Rotation.Degree180;
    case 270:
      return Rotation.Degree270;
    default:
      return Rotation.Degree0;
  }
};

const degreesFromRotation = (rotation: Rotation): number => rotation * 90;

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
  },
  pageNumber: number,
  pageOccurrence: number,
): PdfSearchMatch => ({
  pageNumber,
  pageOccurrence,
  index: result.charIndex,
  excerpt: searchExcerpt(result.context),
});

interface EmbedPdfScrollMetrics {
  readonly pageVisibilityMetrics: readonly {
    readonly pageNumber: number;
    readonly original: { readonly pageY: number };
  }[];
}

interface EmbedPdfScrollLayout {
  readonly virtualItems: readonly {
    readonly pageLayouts: readonly {
      readonly pageNumber: number;
      readonly rotatedHeight: number;
    }[];
  }[];
}

export function captureEmbedPdfReadingPosition(
  page: number,
  metrics: EmbedPdfScrollMetrics,
  layout: EmbedPdfScrollLayout,
): ReadingPosition {
  const visibility = metrics.pageVisibilityMetrics.find((item) => item.pageNumber === page);
  const pageLayout = layout.virtualItems
    .flatMap((item) => item.pageLayouts)
    .find((item) => item.pageNumber === page);
  const location =
    visibility && pageLayout && pageLayout.rotatedHeight > 0
      ? Math.min(1, Math.max(0, visibility.original.pageY / pageLayout.rotatedHeight))
      : 0;
  return { page, location };
}

export function restoreEmbedPdfReadingPositionCoordinates(
  pageSize: { readonly width: number; readonly height: number },
  rotation: Rotation,
  position: ReadingPosition,
): { x: number; y: number } {
  const location = Math.min(1, Math.max(0, position.location));
  switch (rotation) {
    case Rotation.Degree90:
      return { x: pageSize.width * location, y: pageSize.height };
    case Rotation.Degree180:
      return { x: pageSize.width, y: pageSize.height * (1 - location) };
    case Rotation.Degree270:
      return { x: pageSize.width * (1 - location), y: 0 };
    default:
      return { x: 0, y: pageSize.height * location };
  }
}

export function embedPdfLayoutForViewMode(viewMode: ViewMode): {
  scrollStrategy: ScrollStrategy;
  spreadMode: SpreadMode;
} {
  return viewMode === 'continuous'
    ? { scrollStrategy: ScrollStrategy.Vertical, spreadMode: SpreadMode.None }
    : {
        scrollStrategy: ScrollStrategy.Horizontal,
        spreadMode: viewMode === 'spread' ? SpreadMode.Odd : SpreadMode.None,
      };
}

const viewModeForEmbedPdfLayout = (
  scrollStrategy: ScrollStrategy,
  spreadMode: SpreadMode,
): ViewMode => {
  if (spreadMode !== SpreadMode.None) return 'spread';
  return scrollStrategy === ScrollStrategy.Horizontal ? 'single' : 'continuous';
};

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

async function createProductionViewer({
  target,
  callbacks,
  requestPassword,
}: CreateEmbedPdfViewerRequest): Promise<EmbedPdfViewerRuntime> {
  const fonts = await preloadLocalFonts();
  const container = EmbedPDF.init({
    type: 'container',
    target,
    ...createEmbedPdfViewerConfig((fontPath) => fonts.get(fontPath) ?? null),
  });
  if (!container) throw new Error('EmbedPDF did not create a viewer container');
  const registry = await container.registry;
  await registry.pluginsReady();
  const documentManager = requireCapability<DocumentManagerCapability>(
    registry,
    'document-manager',
  );
  const commands = requireCapability<CommandsCapability>(registry, 'commands');
  removeEmbedPdfCommandShortcuts(commands, 'panel:toggle-search', ['Ctrl+F', 'Meta+F']);
  const annotations = requireCapability<AnnotationCapability>(registry, 'annotation');
  const scroll = requireCapability<ScrollCapability>(registry, 'scroll');
  const zoom = requireCapability<ZoomCapability>(registry, 'zoom');
  const rotate = requireCapability<RotateCapability>(registry, 'rotate');
  const spread = requireCapability<SpreadCapability>(registry, 'spread');
  const search = requireCapability<SearchCapability>(registry, 'search');
  const thumbnails = requireCapability<ThumbnailCapability>(registry, 'thumbnail');
  const viewport = requireCapability<ViewportCapability>(registry, 'viewport');
  const engine = registry.getEngine();
  const unsubscribers: Array<() => void> = [];
  const documentId = `monight-${crypto.randomUUID()}`;
  let sourceBytes = new Uint8Array();
  let fileName = '';
  let documentObject: ReturnType<DocumentManagerCapability['getDocument']> = null;
  let selectedViewMode: ViewMode = 'single';
  let selectedRotation = 0;
  let selectedScrollStrategy = ScrollStrategy.Vertical;
  let selectedSpreadMode = SpreadMode.None;
  let destroyed = false;
  const projectionDepth = { page: 0, zoom: 0, rotation: 0, viewMode: 0 };
  let initialLayoutReady = false;
  let resolveInitialLayout!: () => void;
  const initialLayoutReadyPromise = new Promise<void>((resolve) => {
    resolveInitialLayout = resolve;
  });

  const scrollScope = scroll.forDocument(documentId);
  const annotationScope = annotations.forDocument(documentId);
  const currentPageNumber = () => scrollScope.getCurrentPage();
  const currentReadingPosition = (
    metrics: EmbedPdfScrollMetrics = scrollScope.getMetrics(),
  ): ReadingPosition =>
    captureEmbedPdfReadingPosition(currentPageNumber(), metrics, scrollScope.getLayout());
  const publishViewModeFromLayout = (): void => {
    const nextViewMode = viewModeForEmbedPdfLayout(selectedScrollStrategy, selectedSpreadMode);
    const changed = nextViewMode !== selectedViewMode;
    selectedViewMode = nextViewMode;
    callbacks.stateChanged();
    if (projectionDepth.viewMode === 0 && changed) {
      void callbacks.viewModeRequested?.(nextViewMode);
    }
  };
  const linkTargetForEvent = (event: Event): EmbedPdfLinkTarget | null => {
    const path = event.composedPath();
    if (!path.some((target) => target instanceof Element && isEmbedPdfLinkHitArea(target))) {
      return null;
    }
    return embedPdfLinkTargetAtGeometry(
      annotationScope.getAnnotations(),
      embedPdfLinkGeometries(path),
      zoom.forDocument(documentId).getState().currentZoomLevel,
      currentPageNumber(),
    );
  };
  const interceptEmbedPdfLink = (event: Event): void => {
    const target = linkTargetForEvent(event);
    if (!target) return;
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    event.preventDefault();
    const monightTarget = embedPdfLinkTarget(target);
    if (!monightTarget || !callbacks.linkTargetRequested) return;
    void callbacks.linkTargetRequested(monightTarget).catch((error) => {
      console.error('Failed to activate EmbedPDF link:', error);
    });
  };
  const shadowRoot = container.shadowRoot;
  if (!shadowRoot) throw new Error('EmbedPDF viewer shadow root is unavailable');
  shadowRoot.addEventListener('pointerdown', interceptEmbedPdfLink, { capture: true });
  shadowRoot.addEventListener('click', interceptEmbedPdfLink, { capture: true });
  unsubscribers.push(
    () => shadowRoot.removeEventListener('pointerdown', interceptEmbedPdfLink, { capture: true }),
    () => shadowRoot.removeEventListener('click', interceptEmbedPdfLink, { capture: true }),
  );

  unsubscribers.push(
    scroll.onPageChange((event) => {
      if (event.documentId !== documentId) return;
      callbacks.stateChanged();
      if (projectionDepth.page === 0) void callbacks.pageNavigationRequested(event.pageNumber);
    }),
    scrollScope.onScroll((metrics) => {
      callbacks.stateChanged();
      callbacks.readingPositionObserved(currentReadingPosition(metrics));
    }),
    scroll.onLayoutReady((event) => {
      if (event.documentId !== documentId || !event.isInitial || initialLayoutReady) return;
      initialLayoutReady = true;
      resolveInitialLayout();
    }),
    scroll.onStateChange((state) => {
      if (state.strategy === selectedScrollStrategy) return;
      selectedScrollStrategy = state.strategy;
      publishViewModeFromLayout();
    }),
    viewport.onScrollActivity((event) => {
      if (
        event.documentId === documentId &&
        !event.activity.isScrolling &&
        !event.activity.isSmoothScrolling
      ) {
        callbacks.readingPositionSettled(currentReadingPosition());
      }
    }),
    zoom.onZoomChange((event) => {
      if (event.documentId !== documentId) return;
      callbacks.stateChanged();
      if (projectionDepth.zoom === 0)
        void callbacks.zoomIntentRequested(zoomIntentFromLevel(event.level));
    }),
    rotate.onRotateChange((event) => {
      if (event.documentId !== documentId) return;
      const nextRotation = degreesFromRotation(event.rotation);
      const delta = (nextRotation - selectedRotation + 360) % 360;
      selectedRotation = nextRotation;
      callbacks.stateChanged();
      if (projectionDepth.rotation === 0 && delta === 90) {
        void callbacks.rotationRequested?.('clockwise');
      } else if (projectionDepth.rotation === 0 && delta === 270) {
        void callbacks.rotationRequested?.('counter-clockwise');
      }
    }),
    spread.onSpreadChange((event) => {
      if (event.documentId !== documentId) return;
      if (event.spreadMode === selectedSpreadMode) return;
      selectedSpreadMode = event.spreadMode;
      publishViewModeFromLayout();
    }),
  );

  const currentDocument = () => {
    if (!documentObject) throw new Error('EmbedPDF Document Content is not loaded');
    return documentObject;
  };
  const withProjection = async (
    kind: keyof typeof projectionDepth,
    work: () => void,
  ): Promise<void> => {
    projectionDepth[kind] += 1;
    try {
      work();
      await waitForPresentationFrames();
    } finally {
      projectionDepth[kind] -= 1;
    }
  };

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
    openSearch() {
      commands.forDocument(documentId).execute('panel:toggle-search', 'api');
    },
    pageCount: () => documentObject?.pageCount ?? 0,
    currentPage: currentPageNumber,
    currentZoom: () => zoom.forDocument(documentId).getState().currentZoomLevel,
    zoomIntent: () => zoomIntentFromLevel(zoom.forDocument(documentId).getState().zoomLevel),
    rotation: () => degreesFromRotation(rotate.forDocument(documentId).getRotation()),
    viewMode: () => selectedViewMode,
    readingPosition: currentReadingPosition,
    goToPage: (pageNumber) =>
      withProjection('page', () =>
        scroll.forDocument(documentId).scrollToPage({ pageNumber, behavior: 'instant' }),
      ),
    goToReadingPosition: (position) =>
      withProjection('page', () => {
        if ('legacyOffset' in position) {
          scrollScope.scrollToPage({ pageNumber: position.page, behavior: 'instant' });
          return;
        }
        const page = currentDocument().pages[position.page - 1];
        const rotation = (((page?.rotation ?? 0) + rotate.forDocument(documentId).getRotation()) %
          4) as Rotation;
        scrollScope.scrollToPage({
          pageNumber: position.page,
          pageCoordinates: page
            ? restoreEmbedPdfReadingPositionCoordinates(page.size, rotation, position)
            : undefined,
          behavior: 'instant',
        });
      }),
    setZoomIntent: (intent) =>
      withProjection('zoom', () =>
        zoom.forDocument(documentId).requestZoom(zoomLevelFromIntent(intent)),
      ),
    zoomIn: () => withProjection('zoom', () => zoom.forDocument(documentId).zoomIn()),
    zoomOut: () => withProjection('zoom', () => zoom.forDocument(documentId).zoomOut()),
    setRotation: (rotation) =>
      withProjection('rotation', () => {
        selectedRotation = ((rotation % 360) + 360) % 360;
        rotate.forDocument(documentId).setRotation(rotationFromDegrees(rotation));
      }),
    setViewMode: (viewMode) =>
      withProjection('viewMode', () => {
        const layout = embedPdfLayoutForViewMode(viewMode);
        selectedViewMode = viewMode;
        selectedScrollStrategy = layout.scrollStrategy;
        selectedSpreadMode = layout.spreadMode;
        scrollScope.setScrollStrategy(layout.scrollStrategy);
        spread.forDocument(documentId).setSpreadMode(layout.spreadMode);
      }),
    fitToPage: () =>
      withProjection('zoom', () => zoom.forDocument(documentId).requestZoom(ZoomMode.FitPage)),
    applyFilter(filterCss) {
      container.style.filter = filterCss;
    },
    setVisible(visible) {
      target.dataset.visible = String(visible);
    },
    async search(query, options) {
      if (options.isCancelled() || !query.trim()) return [];
      const task = search.forDocument(documentId).searchAllPages(query);
      const progressMatches: PdfSearchMatch[] = [];
      const pageOccurrences = new Map<number, number>();
      task.onProgress(({ page, results }) => {
        if (options.isCancelled()) return;
        const pageMatches = results.map((result) => {
          const pageNumber = page + 1;
          const pageOccurrence = pageOccurrences.get(pageNumber) ?? 0;
          pageOccurrences.set(pageNumber, pageOccurrence + 1);
          return createSearchMatch(result, pageNumber, pageOccurrence);
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
        return createSearchMatch(match, pageNumber, pageOccurrence);
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
        return {
          title: bookmark.title,
          pageNumber: typeof pageIndex === 'number' ? pageIndex + 1 : null,
          ...(target?.action?.uri ? { url: target.action.uri } : {}),
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
      if (target.dest && !Array.isArray(target.dest) && typeof target.dest !== 'string') {
        const page = currentDocument().pages[target.dest.pageIndex];
        const position = embedPdfDestinationReadingPosition(
          target.dest,
          currentDocument().pageCount,
          page?.size.height ?? 0,
        );
        return {
          kind: 'page',
          pageNumber: position.page,
          location: position.location,
        };
      }
      return null;
    },
    async renderThumbnail(pageNumber, maxWidth) {
      const blob = await thumbnails
        .forDocument(documentId)
        .renderThumb(pageNumber - 1, window.devicePixelRatio || 1)
        .toPromise();
      return blobToCanvas(blob, maxWidth);
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

interface CreateEmbedPdfDocumentSurfaceFactoryOptions {
  readonly createViewer?: EmbedPdfViewerFactory;
  readonly requestPassword?: CreateEmbedPdfViewerRequest['requestPassword'];
}

export function createEmbedPdfDocumentSurfaceFactory({
  createViewer = createProductionViewer,
  requestPassword,
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
      viewer = await createViewer({ target, callbacks, requestPassword });
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
      goToPage: (pageNumber) => openedViewer.goToPage(pageNumber),
      goToReadingPosition: (position) => openedViewer.goToReadingPosition(position),
      setZoomIntent: (intent) => openedViewer.setZoomIntent(intent),
      zoomIn: () => openedViewer.zoomIn(),
      zoomOut: () => openedViewer.zoomOut(),
      setRotation: (rotation) => openedViewer.setRotation(rotation),
      setViewMode: (viewMode) => openedViewer.setViewMode(viewMode),
      fitToPage: () => openedViewer.fitToPage(),
      applyFilter: (filterCss) => openedViewer.applyFilter(filterCss),
      setVisible: (visible) => openedViewer.setVisible(visible),
      revealSearchMatch: (match) => openedViewer.goToPage(match.pageNumber),
      setSearchQuery: () => undefined,
      clearSearch: () => undefined,
      setAnnotations() {
        throw new Error('EmbedPDF development surface is read-only');
      },
      async addPageNote() {
        throw new Error('EmbedPDF development surface is read-only');
      },
      updateAnnotation() {
        throw new Error('EmbedPDF development surface is read-only');
      },
      removeAnnotation() {
        throw new Error('EmbedPDF development surface is read-only');
      },
      destroy() {
        void destroy();
      },
    };
    const runtime: DocumentRuntime = {
      content,
      renderThumbnail: (pageNumber, options) =>
        openedViewer.renderThumbnail(pageNumber, options?.maxWidth),
      getAnnotations: (): readonly PdfAnnotation[] => [],
      destroy,
    };
    return { rendering, runtime } satisfies DocumentSurface;
  };
}
