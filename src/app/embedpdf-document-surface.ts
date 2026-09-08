import EmbedPDF, {
  type DocumentManagerCapability,
  type PDFViewerConfig,
  type PluginRegistry,
  type RotateCapability,
  Rotation,
  type ScrollCapability,
  type SearchCapability,
  type SpreadCapability,
  SpreadMode,
  type ThumbnailCapability,
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
  return localFontData;
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
  const scroll = requireCapability<ScrollCapability>(registry, 'scroll');
  const zoom = requireCapability<ZoomCapability>(registry, 'zoom');
  const rotate = requireCapability<RotateCapability>(registry, 'rotate');
  const spread = requireCapability<SpreadCapability>(registry, 'spread');
  const search = requireCapability<SearchCapability>(registry, 'search');
  const thumbnails = requireCapability<ThumbnailCapability>(registry, 'thumbnail');
  const engine = registry.getEngine();
  const unsubscribers: Array<() => void> = [];
  const documentId = `monight-${crypto.randomUUID()}`;
  let sourceBytes = new Uint8Array();
  let fileName = '';
  let documentObject: ReturnType<DocumentManagerCapability['getDocument']> = null;
  let selectedViewMode: ViewMode = 'single';
  let destroyed = false;
  let projectingPage = 0;
  let projectingZoom = 0;

  unsubscribers.push(
    scroll.onPageChange((event) => {
      if (event.documentId !== documentId) return;
      callbacks.stateChanged();
      const position = { page: event.pageNumber, location: 0 };
      callbacks.readingPositionObserved(position);
      callbacks.readingPositionSettled(position);
      if (projectingPage === 0) void callbacks.pageNavigationRequested(event.pageNumber);
    }),
    zoom.onZoomChange((event) => {
      if (event.documentId !== documentId) return;
      callbacks.stateChanged();
      if (projectingZoom === 0)
        void callbacks.zoomIntentRequested(zoomIntentFromLevel(event.level));
    }),
    rotate.onRotateChange((event) => {
      if (event.documentId === documentId) callbacks.stateChanged();
    }),
    spread.onSpreadChange((event) => {
      if (event.documentId === documentId) callbacks.stateChanged();
    }),
  );

  const currentDocument = () => {
    if (!documentObject) throw new Error('EmbedPDF Document Content is not loaded');
    return documentObject;
  };
  const currentPageNumber = () => scroll.forDocument(documentId).getCurrentPage();
  const withPageProjection = async (work: () => void): Promise<void> => {
    projectingPage += 1;
    try {
      work();
      await Promise.resolve();
    } finally {
      projectingPage -= 1;
    }
  };
  const withZoomProjection = async (work: () => void): Promise<void> => {
    projectingZoom += 1;
    try {
      work();
      await Promise.resolve();
    } finally {
      projectingZoom -= 1;
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
    },
    pageCount: () => documentObject?.pageCount ?? 0,
    currentPage: currentPageNumber,
    currentZoom: () => zoom.forDocument(documentId).getState().currentZoomLevel,
    zoomIntent: () => zoomIntentFromLevel(zoom.forDocument(documentId).getState().zoomLevel),
    rotation: () => degreesFromRotation(rotate.forDocument(documentId).getRotation()),
    viewMode: () => selectedViewMode,
    readingPosition: () => ({ page: currentPageNumber(), location: 0 }),
    goToPage: (pageNumber) =>
      withPageProjection(() =>
        scroll.forDocument(documentId).scrollToPage({ pageNumber, behavior: 'instant' }),
      ),
    goToReadingPosition: (position) =>
      withPageProjection(() =>
        scroll
          .forDocument(documentId)
          .scrollToPage({ pageNumber: position.page, behavior: 'instant' }),
      ),
    setZoomIntent: (intent) =>
      withZoomProjection(() =>
        zoom.forDocument(documentId).requestZoom(zoomLevelFromIntent(intent)),
      ),
    zoomIn: () => withZoomProjection(() => zoom.forDocument(documentId).zoomIn()),
    zoomOut: () => withZoomProjection(() => zoom.forDocument(documentId).zoomOut()),
    async setRotation(rotation) {
      rotate.forDocument(documentId).setRotation(rotationFromDegrees(rotation));
    },
    async setViewMode(viewMode) {
      selectedViewMode = viewMode;
      spread
        .forDocument(documentId)
        .setSpreadMode(viewMode === 'spread' ? SpreadMode.Odd : SpreadMode.None);
    },
    fitToPage: () =>
      withZoomProjection(() => zoom.forDocument(documentId).requestZoom(ZoomMode.FitPage)),
    applyFilter(filterCss) {
      container.style.filter = filterCss;
    },
    setVisible(visible) {
      target.hidden = !visible;
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
          return {
            pageNumber,
            pageOccurrence,
            index: result.charIndex,
            excerpt: searchExcerpt(result.context),
          };
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
        return {
          pageNumber,
          pageOccurrence,
          index: match.charIndex,
          excerpt: searchExcerpt(match.context),
        };
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
      return target.url ? { kind: 'external', url: target.url } : null;
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
    const root = document.getElementById('pdf-container');
    if (!root) throw new Error("Container element 'pdf-container' not found");
    const target = document.createElement('div');
    target.className = 'embedpdf-document-surface';
    target.hidden = true;
    root.append(target);
    let viewer: EmbedPdfViewerRuntime | null = null;
    const sourceBytes = bytes.slice();
    try {
      viewer = await createViewer({ target, callbacks, requestPassword });
      await viewer.open({ bytes: sourceBytes, title, filePath, signal });
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
      setAnnotations: () => undefined,
      async addPageNote() {
        throw new Error('EmbedPDF development surface is read-only');
      },
      updateAnnotation: () => undefined,
      removeAnnotation: () => undefined,
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
