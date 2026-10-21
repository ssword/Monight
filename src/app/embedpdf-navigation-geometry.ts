import {
  PdfAnnotationSubtype,
  type PdfLinkAnnoObject,
  Rotation,
  ScrollStrategy,
  SpreadMode,
  type TrackedAnnotation,
  type ZoomLevel,
  ZoomMode,
} from '@embedpdf/snippet';
import type { ViewMode } from '../lib/document-features';
import type { PdfLinkTarget } from '../lib/pdf-links';
import type {
  DocumentAnnotationKind,
  DocumentAnnotationSnapshot,
} from '../reader/document-queries';
import type { ReadingPosition, ZoomIntent } from '../reader/reader-actions';

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

// EmbedPDF 2.15.0 DOM integration. Revalidate against the actual runtime on upgrade.
export function isEmbedPdfLinkHitArea(element: Element): boolean {
  return (
    (element.tagName.toLowerCase() === 'rect' &&
      element.getAttribute('fill') === 'transparent' &&
      element.getAttribute('style')?.includes('cursor: pointer') === true &&
      element.getAttribute('style')?.includes('pointer-events: visible') === true) ||
    (element.tagName.toLowerCase() === 'div' &&
      element.getAttribute('style')?.includes('cursor: pointer') === true &&
      element.getAttribute('style')?.includes('pointer-events: auto') === true)
  );
}

export function embedPdfLinkGeometries(path: readonly EventTarget[]): EmbedPdfLinkGeometry[] {
  return path.flatMap((target) => {
    if (!(target instanceof HTMLElement)) return [];
    const geometry = {
      left: Number.parseFloat(target.style.left),
      top: Number.parseFloat(target.style.top),
      width: Number.parseFloat(target.style.width),
      height: Number.parseFloat(target.style.height),
    };
    return Object.values(geometry).every(Number.isFinite) ? [geometry] : [];
  });
}

// EmbedPDF 2.15.0 DOM integration. Revalidate against the actual runtime on upgrade.
export function embedPdfReadingFilterStyle(): string {
  return `
    .bg-bg-app[style*="overflow: auto"] {
      /* The virtual scroller already preserves page offsets with spacers.
         WebKit scroll anchoring otherwise adds a page when one is evicted. */
      overflow-anchor: none;
    }
    .bg-bg-app[style*="overflow: auto"] > div {
      filter: var(--monight-reading-filter, none);
    }
  `;
}

export function zoomIntentFromEmbedPdfLevel(level: ZoomLevel): ZoomIntent {
  if (typeof level === 'number') return { kind: 'manual', scale: level };
  return level === ZoomMode.FitWidth ? { kind: 'fit-width' } : { kind: 'fit-page' };
}

export function embedPdfZoomLevelFromIntent(intent: ZoomIntent): ZoomLevel {
  if (intent.kind === 'manual') return intent.scale;
  return intent.kind === 'fit-width' ? ZoomMode.FitWidth : ZoomMode.FitPage;
}

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

export function viewModeForEmbedPdfLayout(
  scrollStrategy: ScrollStrategy,
  spreadMode: SpreadMode,
): ViewMode {
  if (spreadMode !== SpreadMode.None) return 'spread';
  return scrollStrategy === ScrollStrategy.Horizontal ? 'single' : 'continuous';
}

const LISTED_ANNOTATION_KINDS: ReadonlyMap<PdfAnnotationSubtype, DocumentAnnotationKind> = new Map([
  [PdfAnnotationSubtype.HIGHLIGHT, 'highlight'],
  [PdfAnnotationSubtype.UNDERLINE, 'underline'],
  [PdfAnnotationSubtype.STRIKEOUT, 'strikeout'],
  [PdfAnnotationSubtype.SQUIGGLY, 'squiggly'],
  [PdfAnnotationSubtype.TEXT, 'note'],
]);

interface EmbedPdfAnnotationPage {
  readonly size: { readonly width: number; readonly height: number };
  readonly rotation?: Rotation;
}

/** Room left above a revealed Annotation, in PDF points, so it never sits under the viewer's page inset. */
const ANNOTATION_REVEAL_MARGIN = 24;

/** Just above the displayed top edge of a page-space rect, as a fraction of the displayed page height. */
function annotationLocation(
  { origin, size }: TrackedAnnotation['object']['rect'],
  page: EmbedPdfAnnotationPage | undefined,
): number {
  if (!page) return 0;
  const { width, height } = page.size;
  const location = (() => {
    switch (page.rotation ?? Rotation.Degree0) {
      case Rotation.Degree90:
        return width > 0 ? (origin.x - ANNOTATION_REVEAL_MARGIN) / width : 0;
      case Rotation.Degree180:
        return height > 0 ? 1 - (origin.y + size.height + ANNOTATION_REVEAL_MARGIN) / height : 0;
      case Rotation.Degree270:
        return width > 0 ? 1 - (origin.x + size.width + ANNOTATION_REVEAL_MARGIN) / width : 0;
      default:
        return height > 0 ? (origin.y - ANNOTATION_REVEAL_MARGIN) / height : 0;
    }
  })();
  return Math.min(1, Math.max(0, location));
}

const isoDate = (value: unknown): string | null =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;

/** Text-markup and note Annotations of any author, by page then from the top of the page. */
export function embedPdfAnnotationSnapshots(
  annotations: readonly TrackedAnnotation[],
  pages: readonly EmbedPdfAnnotationPage[],
): DocumentAnnotationSnapshot[] {
  const snapshots: DocumentAnnotationSnapshot[] = [];
  for (const { commitState, object } of annotations) {
    const kind = LISTED_ANNOTATION_KINDS.get(object.type);
    if (!kind || commitState === 'deleted') continue;
    const page = object.pageIndex + 1;
    const color =
      'strokeColor' in object && typeof object.strokeColor === 'string'
        ? object.strokeColor
        : 'color' in object && typeof object.color === 'string'
          ? object.color
          : null;
    snapshots.push({
      id: object.id,
      kind,
      pageNumber: page,
      readingPosition: { page, location: annotationLocation(object.rect, pages[object.pageIndex]) },
      author: object.author ?? '',
      contents: object.contents ?? '',
      color,
      modified: isoDate(object.modified) ?? isoDate(object.created),
    });
  }
  return snapshots.sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.readingPosition.location - right.readingPosition.location,
  );
}
