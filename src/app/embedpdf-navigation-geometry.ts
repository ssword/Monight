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
    .bg-bg-app[style*="overflow: auto"] > div {
      filter: var(--monight-reading-filter, none);
    }
  `;
}

// EmbedPDF 2.15.0 has no bookmark activation hook. Capture its ready-made rows,
// preserving tree indices (titles need not be unique) and leaving expand buttons
// alone. Actual-runtime contracts guard this pinned DOM integration; revalidate on upgrade.
export function embedPdfOutlinePath(event: Event): number[] | null {
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
}

export function zoomIntentFromEmbedPdfLevel(level: ZoomLevel): ZoomIntent {
  if (typeof level === 'number') return { kind: 'manual', scale: level };
  return level === ZoomMode.FitWidth ? { kind: 'fit-width' } : { kind: 'fit-page' };
}

export function embedPdfZoomLevelFromIntent(intent: ZoomIntent): ZoomLevel {
  if (intent.kind === 'manual') return intent.scale;
  return intent.kind === 'fit-width' ? ZoomMode.FitWidth : ZoomMode.FitPage;
}

export function embedPdfRotationFromDegrees(degrees: number): Rotation {
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
}

export function degreesFromEmbedPdfRotation(rotation: Rotation): number {
  return rotation * 90;
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
