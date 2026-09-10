import { PdfPermissionFlag } from '@embedpdf/models';
import EmbedPDF, {
  type AnnotationCapability,
  type CommandsCapability,
  type DocumentManagerCapability,
  LockModeType,
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
import {
  type AnnotationDisplayName,
  DEFAULT_ANNOTATION_DISPLAY_NAME,
  type NativePdfEditing,
} from '../reader/native-pdf-editing';
import type {
  ReaderActionOptions,
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
const ENABLED_ANNOTATION_TOOL_IDS = ['highlight', 'textComment'] as const;

const DISABLED_CATEGORIES = [
  'annotation',
  'redaction',
  'insert',
  'document-open',
  'document-close',
  'document-print',
  'document-export',
  'document-protect',
  'document-capture',
  // Reading Session supports single, continuous, and odd-page spreads.
  'spread-even',
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

export function createEmbedPdfViewerConfig(
  fontLoader?: LocalFontLoader,
  editable = false,
  annotationDisplayName: AnnotationDisplayName = DEFAULT_ANNOTATION_DISPLAY_NAME,
): PDFViewerConfig {
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
    disabledCategories: [
      ...DISABLED_CATEGORIES.filter((category) => !editable || category !== 'annotation'),
      'form',
      'signature',
      'annotation-ink',
      'annotation-shape',
      'annotation-text',
      'annotation-underline',
      'annotation-strikeout',
      'annotation-squiggly',
      'annotation-insert-text',
      'annotation-replace-text',
      'annotation-link',
      'annotation-group',
      'annotation-widget-edit',
    ],
    permissions: {
      enforceDocumentPermissions: true,
      overrides: {
        modifyContents: false,
        ...(editable ? {} : { modifyAnnotations: false }),
        fillForms: false,
        assembleDocument: false,
      },
    },
    render: { withAnnotations: true, withForms: false },
    annotations: {
      autoOpenLinks: false,
      annotationAuthor: annotationDisplayName,
      autoCommit: false,
      tools: ENABLED_ANNOTATION_TOOL_IDS.map((id) => ({
        id,
        categories: ['monight-native'],
      })),
      locked: editable
        ? { type: LockModeType.Exclude, categories: ['monight-native'] }
        : { type: LockModeType.All },
    },
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
  openSearch(): void;
  setSearchQuery(query: string): void;
  clearSearch(): void;
  revealSearchMatch(match: PdfSearchMatch): Promise<void>;
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

interface EmbedPdfDestination {
  readonly pageIndex: number;
  readonly zoom?: unknown;
  readonly view?: readonly number[];
}

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

export function embedPdfLinkTarget(
  target: EmbedPdfLinkTarget,
  resolveDestination: (destination: EmbedPdfDestination) => ReadingPosition,
): PdfLinkTarget | null {
  if (target.type === 'action' && target.action?.uri) return { url: target.action.uri };
  const destination =
    target.type === 'destination' ? target.destination : target.action?.destination;
  return destination ? { readingPosition: resolveDestination(destination) } : null;
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
  pageNumber: number,
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
  const match = matches.find(({ object }) => object.pageIndex + 1 === pageNumber);
  return match?.object.target ?? null;
}

interface EmbedPdfPageLookupLayout {
  readonly virtualItems: readonly {
    readonly pageLayouts: readonly { readonly pageNumber: number }[];
  }[];
}

export function embedPdfPageNumberForEventPath(
  path: readonly EventTarget[],
  layout: EmbedPdfPageLookupLayout,
  renderedPageIndexes: readonly number[],
): number | null {
  const pageWrapper = path.find(
    (target): target is HTMLElement =>
      target instanceof HTMLElement &&
      target.style.position === 'relative' &&
      target.parentElement?.style.display === 'flex' &&
      target.parentElement.style.justifyContent === 'center' &&
      target.parentElement.parentElement?.style.position === 'relative',
  );
  const pagesContainer = pageWrapper?.parentElement?.parentElement;
  if (!pageWrapper || !pagesContainer) return null;
  const pageWrappers = [...pagesContainer.children].flatMap((item) => [...item.children]);
  const pageIndex = pageWrappers.indexOf(pageWrapper);
  if (pageIndex < 0) return null;
  return (
    renderedPageIndexes.flatMap((index) => layout.virtualItems[index]?.pageLayouts ?? [])[pageIndex]
      ?.pageNumber ?? null
  );
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

// Snippet 2.15 has no bookmark activation hook. Capture its ready-made rows,
// preserving tree indices (titles need not be unique) and leaving expand buttons
// alone. Actual-runtime contracts guard this pinned DOM integration.
const embedPdfOutlinePath = (event: Event): number[] | null => {
  const path = event.composedPath();
  const origin = path[0];
  if (!(origin instanceof Element) || origin.closest('button')) return null;
  const tree = origin.closest('.outline-tree');
  let item = origin.closest('.select-none');
  if (!tree || !item || !tree.contains(item)) return null;
  const indices: number[] = [];
  while (item && tree.contains(item)) {
    const parent: HTMLElement | null = item.parentElement;
    if (!parent) return null;
    indices.unshift([...parent.children].indexOf(item));
    if (parent === tree) return indices;
    item = parent.closest('.select-none');
  }
  return null;
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
  pageInset = 0,
): ReadingPosition {
  const visibility = metrics.pageVisibilityMetrics.find((item) => item.pageNumber === page);
  const pageLayout = layout.virtualItems
    .flatMap((item) => item.pageLayouts)
    .find((item) => item.pageNumber === page);
  const location =
    visibility && pageLayout && pageLayout.rotatedHeight > 0
      ? Math.min(1, Math.max(0, (visibility.original.pageY - pageInset) / pageLayout.rotatedHeight))
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

/** Compare the supported editable fields, tolerating PDF float serialization only. */
function nativeAnnotationMatches(
  expected: TrackedAnnotation['object'],
  actual: TrackedAnnotation['object'],
): boolean {
  const equal = (a: unknown, b: unknown): boolean => {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((value, index) => equal(value, b[index]));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return Object.entries(a).every(([key, value]) => equal(value, Reflect.get(b, key)));
    }
    return a === b;
  };
  const fields = [
    'id',
    'type',
    'pageIndex',
    'rect',
    'contents',
    'author',
    'strokeColor',
    'opacity',
    'segmentRects',
  ] as const;
  return fields.every((field) => {
    const value = Reflect.get(expected, field);
    const saved = Reflect.get(actual, field);
    if (value === undefined) return true;
    if (field === 'strokeColor' && typeof value === 'string' && typeof saved === 'string')
      return value.toLowerCase() === saved.toLowerCase();
    // PDFium represents alpha in 8 bits and standard note icons as 20pt squares
    // anchored at the lower-left PDF point, independent of the UI's 24pt hit box.
    if (field === 'opacity' && typeof value === 'number' && typeof saved === 'number')
      return Math.round(value * 255) === Math.round(saved * 255);
    if (field === 'rect' && expected.type === PdfAnnotationSubtype.TEXT) {
      return equal(
        {
          origin: {
            x: expected.rect.origin.x,
            y: expected.rect.origin.y + expected.rect.size.height - 20,
          },
          size: { width: 20, height: 20 },
        },
        saved,
      );
    }
    return equal(value, saved);
  });
}

async function createProductionViewer({
  target,
  callbacks,
  requestPassword,
  readOnlyReason = 'Native editing is disabled in this development surface',
  annotationDisplayName,
}: CreateEmbedPdfViewerRequest): Promise<EmbedPdfViewerRuntime> {
  const fonts = await preloadLocalFonts();
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
    if (/^(zoom:|rotate:|scroll:|document:|panel:toggle-search$)/.test(commandId)) {
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
  const rotate = requireCapability<RotateCapability>(registry, 'rotate');
  const spread = requireCapability<SpreadCapability>(registry, 'spread');
  const thumbnails = requireCapability<ThumbnailCapability>(registry, 'thumbnail');
  const viewport = requireCapability<ViewportCapability>(registry, 'viewport');
  const engine = registry.getEngine();
  const unsubscribers: Array<() => void> = [];
  const documentId = `monight-${crypto.randomUUID()}`;
  const searchScope = requireCapability<SearchCapability>(registry, 'search').forDocument(
    documentId,
  );
  let searchEpoch = 0;
  let searchCompletion = Promise.resolve();
  let searchSession = '';
  unsubscribers.push(
    searchScope.onStateChange((state) => {
      // The ready-made panel calls the capability directly, bypassing Monight's
      // presentation methods. Its query/flags/session changes also cancel reveals.
      const nextSession = JSON.stringify([state.query, state.flags, state.active]);
      if (nextSession !== searchSession) {
        searchSession = nextSession;
        searchEpoch += 1;
      }
    }),
  );
  let sourceBytes = new Uint8Array();
  let fileName = '';
  let documentObject: ReturnType<DocumentManagerCapability['getDocument']> = null;
  let selectedViewMode: ViewMode = 'single';
  let selectedRotation = 0;
  let selectedScrollStrategy = ScrollStrategy.Vertical;
  let selectedSpreadMode = SpreadMode.None;
  let destroyed = false;
  let pendingObservedPosition: ReadingPosition | null = null;
  let readingAnchor: ReadingPosition | null = null;
  let selectedZoomIntent: ZoomIntent | null = null;
  let layoutEpoch = 0;
  let observationEpoch = 0;
  const projectionDepth = { page: 0, zoom: 0, rotation: 0, viewMode: 0 };
  let initialLayoutReady = false;
  let resolveInitialLayout!: () => void;
  const initialLayoutReadyPromise = new Promise<void>((resolve) => {
    resolveInitialLayout = resolve;
  });

  const scrollScope = scroll.forDocument(documentId);
  const annotationScope = annotations.forDocument(documentId);
  let editRevision = 0;
  let savedRevision = 0;
  unsubscribers.push(
    annotationScope.onAnnotationEvent((event) => {
      if (
        event.type === 'update' &&
        event.patch.author !== undefined &&
        event.patch.author !== event.annotation.author
      ) {
        annotationScope.syncAnnotationObject(event.annotation.id, {
          author: event.annotation.author,
        });
      }
      if (event.type !== 'loaded' && !event.committed) {
        editRevision += 1;
        callbacks.stateChanged();
      }
    }),
  );
  let retryNativeAnnotations = false;
  const editing: NativePdfEditing = {
    state: () => ({
      revision: editRevision,
      dirty: editRevision !== savedRevision,
      readOnlyReason,
    }),
    async exportPdf() {
      if (readOnlyReason) throw new Error(readOnlyReason);
      const revision = editRevision;
      const expected = annotationScope
        .getAnnotations()
        .filter(({ commitState }) => commitState !== 'deleted')
        .map(({ object }) => structuredClone(object));
      const retry = retryNativeAnnotations;
      retryNativeAnnotations = true;
      await annotationScope.commit().toPromise();
      if (retry) {
        // A failed plugin batch may already be labelled synced. Reconcile the
        // current live edits through the public engine API on an explicit retry,
        // without clearing/recreating the UI or its undo history.
        const doc = currentDocument();
        for (const page of doc.pages) {
          const native = await engine.getPageAnnotations(doc, page).toPromise();
          const desired = expected.filter((annotation) => annotation.pageIndex === page.index);
          for (const annotation of native) {
            if (revision !== editRevision) throw new Error('Annotations changed; retry Save');
            if (!desired.some((item) => item.id === annotation.id)) {
              if (!(await engine.removePageAnnotation(doc, page, annotation).toPromise()))
                throw new Error('Native annotation deletion failed');
            }
          }
          for (const annotation of desired) {
            if (revision !== editRevision) throw new Error('Annotations changed; retry Save');
            const existing = native.find((item) => item.id === annotation.id);
            if (!existing) await engine.createPageAnnotation(doc, page, annotation).toPromise();
            else if (!nativeAnnotationMatches(annotation, existing)) {
              if (!(await engine.updatePageAnnotation(doc, page, annotation).toPromise()))
                throw new Error('Native annotation update failed');
            }
          }
        }
      }
      const buffer = await engine.saveAsCopy(currentDocument()).toPromise();
      // The pinned plugin can resolve commit() despite a failed individual mutation.
      // Reopen exported bytes and check native fields before permitting a disk write.
      const verification = await engine
        .openDocumentBuffer({ id: `verify-${crypto.randomUUID()}`, content: buffer })
        .toPromise();
      try {
        const actual = (
          await Promise.all(
            verification.pages.map((page) =>
              engine.getPageAnnotations(verification, page).toPromise(),
            ),
          )
        ).flat();
        if (
          expected.length !== actual.length ||
          expected.some((annotation) => {
            const reopened = actual.find((item) => item.id === annotation.id);
            return !reopened || !nativeAnnotationMatches(annotation, reopened);
          })
        ) {
          throw new Error('Native annotation verification failed; unsaved edits were retained');
        }
      } finally {
        await engine.closeDocument(verification).toPromise();
      }
      const bytes = new Uint8Array(buffer);
      if (revision !== editRevision)
        throw new Error('Annotations changed during export; retry Save');
      retryNativeAnnotations = false;
      return bytes;
    },
    markSaved(revision) {
      savedRevision = revision;
      callbacks.stateChanged();
    },
    markRecovered(revision) {
      editRevision = Math.max(editRevision, revision);
      savedRevision = 0;
      callbacks.stateChanged();
    },
    setAnnotationDisplayName(displayName) {
      for (const toolId of ENABLED_ANNOTATION_TOOL_IDS) {
        annotations.setToolDefaults(toolId, { author: displayName });
      }
    },
  };
  const currentPageNumber = () => scrollScope.getCurrentPage();
  const currentReadingPosition = (
    metrics: EmbedPdfScrollMetrics = scrollScope.getMetrics(),
  ): ReadingPosition =>
    captureEmbedPdfReadingPosition(
      currentPageNumber(),
      metrics,
      scrollScope.getLayout(),
      viewport.getViewportGap() / zoom.forDocument(documentId).getState().currentZoomLevel,
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
  const linkTargetForEvent = (event: Event): EmbedPdfLinkTarget | null => {
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
      zoom.forDocument(documentId).getState().currentZoomLevel,
      pageNumber,
    );
  };
  const requestLinkTarget = async (target: EmbedPdfLinkTarget): Promise<void> => {
    if (destroyed) return;
    const monightTarget = embedPdfLinkTarget(target, (destination) => {
      const page = currentDocument().pages[destination.pageIndex];
      return embedPdfDestinationReadingPosition(
        destination,
        currentDocument().pageCount,
        page?.size.height ?? 0,
      );
    });
    if (!monightTarget || !callbacks.linkTargetRequested) return;
    await callbacks.linkTargetRequested(monightTarget);
  };
  const requestOutlineTarget = async (indices: number[]): Promise<void> => {
    const result = await engine.getBookmarks(currentDocument()).toPromise();
    let bookmarks = result.bookmarks;
    for (const [depth, index] of indices.entries()) {
      const bookmark = bookmarks[index];
      if (!bookmark) return;
      if (depth === indices.length - 1 && bookmark.target) {
        await requestLinkTarget(bookmark.target);
      }
      bookmarks = bookmark.children ?? [];
    }
  };
  const interceptEmbedPdfLink = (event: Event): void => {
    const outlinePath = embedPdfOutlinePath(event);
    const target = outlinePath ? null : linkTargetForEvent(event);
    if (!outlinePath && !target) return;
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    event.preventDefault();
    const activation = outlinePath
      ? requestOutlineTarget(outlinePath)
      : target
        ? requestLinkTarget(target)
        : Promise.resolve();
    void activation.catch((error) => {
      console.error('Failed to activate EmbedPDF link:', error);
    });
  };
  const shadowRoot = container.shadowRoot;
  if (!shadowRoot) throw new Error('EmbedPDF viewer shadow root is unavailable');
  // The pinned ready-made viewer's viewport owns the page layers. Filtering its
  // contents keeps text/annotations aligned and leaves toolbars and panels alone.
  const readingStyle = document.createElement('style');
  readingStyle.textContent = `
    .bg-bg-app[style*="overflow: auto"] > div {
      filter: var(--monight-reading-filter, none);
    }
  `;
  shadowRoot.append(readingStyle);
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
      // or rotate notification. Give that notification time to cancel the sample.
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
      const intent = zoomIntentFromLevel(
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
    rotate.onRotateChange((event) => {
      if (event.documentId !== documentId) return;
      const nextRotation = degreesFromRotation(event.rotation);
      const delta = (nextRotation - selectedRotation + 360) % 360;
      selectedRotation = nextRotation;
      callbacks.stateChanged();
      // setRotation records its target before calling the viewer, making its own
      // event delta zero. A distinct user turn must survive an in-flight render.
      if (delta === 90) {
        void callbacks.rotationRequested?.('clockwise');
      } else if (delta === 270) {
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
  const scrollToPosition = (position: RestorableReadingPosition): void => {
    if (destroyed) return;
    readingAnchor = 'location' in position ? { ...position } : { page: position.page, location: 0 };
    const page = currentDocument().pages[position.page - 1];
    const rotation = (((page?.rotation ?? 0) + rotate.forDocument(documentId).getRotation()) %
      4) as Rotation;
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
    async preparePrintDocument() {
      const document = currentDocument();
      if ((document.permissions & PdfPermissionFlag.Print) === 0) {
        throw new Error('Document permissions prohibit printing');
      }
      if (!readOnlyReason) return editing.exportPdf();
      const buffer = await engine
        .preparePrintDocument(document, { includeAnnotations: true })
        .toPromise();
      return new Uint8Array(buffer);
    },
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
    setSearchQuery(query) {
      if (destroyed) return;
      searchEpoch += 1;
      searchCompletion = searchScope
        .searchAllPages(query)
        .toPromise()
        .then(
          () => undefined,
          () => undefined,
        );
    },
    clearSearch() {
      searchEpoch += 1;
      if (!destroyed) searchScope.stopSearch();
    },
    async revealSearchMatch(match) {
      const epoch = searchEpoch;
      const isCancelled = () => destroyed || epoch !== searchEpoch;
      await searchCompletion;
      if (isCancelled()) return;
      const state = searchScope.getState();
      const index = state.results.findIndex(
        (result) => result.pageIndex + 1 === match.pageNumber && result.charIndex === match.index,
      );
      const result = state.results[index];
      if (!result) return;
      const page = currentDocument().pages[result.pageIndex];
      const y = Math.min(...result.rects.map((rect) => rect.origin.y));
      if (callbacks.linkTargetRequested) {
        await callbacks.linkTargetRequested(
          {
            readingPosition: {
              page: match.pageNumber,
              location:
                page && Number.isFinite(y) ? Math.min(1, Math.max(0, y / page.size.height)) : 0,
            },
          },
          { isCancelled },
        );
      } else {
        await callbacks.pageNavigationRequested(match.pageNumber, { isCancelled });
      }
      if (!isCancelled()) searchScope.goToResult(index);
    },
    pageCount: () => documentObject?.pageCount ?? 0,
    currentPage: currentPageNumber,
    currentZoom: () => zoom.forDocument(documentId).getState().currentZoomLevel,
    zoomIntent: () => zoomIntentFromLevel(zoom.forDocument(documentId).getState().zoomLevel),
    rotation: () => degreesFromRotation(rotate.forDocument(documentId).getRotation()),
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
        JSON.stringify(zoomIntentFromLevel(zoom.forDocument(documentId).getState().zoomLevel))
      )
        return Promise.resolve();
      return withProjection('zoom', () =>
        zoom.forDocument(documentId).requestZoom(zoomLevelFromIntent(intent)),
      );
    },
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
  readonly assessEditing?: (bytes: Uint8Array) => Promise<string | null>;
  readonly getAnnotationDisplayName?: () => AnnotationDisplayName;
  readonly createViewer?: EmbedPdfViewerFactory;
  readonly requestPassword?: CreateEmbedPdfViewerRequest['requestPassword'];
}

export function createEmbedPdfDocumentSurfaceFactory({
  createViewer = createProductionViewer,
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
      let readOnlyReason = 'Native editing is disabled in this development surface';
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
      revealSearchMatch: (match) => openedViewer.revealSearchMatch(match),
      setSearchQuery: (query) => openedViewer.setSearchQuery(query),
      clearSearch: () => openedViewer.clearSearch(),
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
      ...(assessEditing && openedViewer.editing ? { editing: openedViewer.editing } : {}),
      preparePrintDocument: () => openedViewer.preparePrintDocument(),
      content,
      renderThumbnail: (pageNumber, options) =>
        openedViewer.renderThumbnail(pageNumber, options?.maxWidth),
      getAnnotations: (): readonly PdfAnnotation[] => [],
      destroy,
    };
    return { rendering, runtime } satisfies DocumentSurface;
  };
}
