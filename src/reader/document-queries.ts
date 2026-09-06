import type {
  PdfAnnotation,
  PdfOutlineItem,
  PdfSearchMatch,
  SearchProgress,
} from '../lib/document-features';
import type { PdfLinkTarget } from '../lib/pdf-links';
import type {
  DocumentContent,
  DocumentContentMetadata,
  ResolvedDocumentLinkTarget,
} from './document-content';

export interface DocumentThumbnailOptions {
  readonly maxWidth?: number;
  readonly rotation?: number;
}

export interface DocumentRuntime {
  readonly content: DocumentContent;
  destroy(): Promise<void>;
  renderThumbnail(
    pageNumber: number,
    options?: DocumentThumbnailOptions,
  ): Promise<HTMLCanvasElement>;
  getAnnotations(): readonly PdfAnnotation[];
}

export interface DocumentQueryOptions {
  readonly isCancelled?: () => boolean;
}

export interface DocumentSearchQueryOptions extends DocumentQueryOptions {
  readonly onProgress?: (progress: SearchProgress) => void;
}

export interface DocumentQuery {
  readonly filePath: string;
  readonly generation: number;
  isCurrent(): boolean;
  search(query: string, options?: DocumentSearchQueryOptions): Promise<readonly PdfSearchMatch[]>;
  outline(options?: DocumentQueryOptions): Promise<readonly PdfOutlineItem[]>;
  metadata(options?: DocumentQueryOptions): Promise<DocumentContentMetadata | null>;
  resolveLinkTarget(
    target: PdfLinkTarget,
    options?: DocumentQueryOptions,
  ): Promise<ResolvedDocumentLinkTarget | null>;
  thumbnail(
    pageNumber: number,
    options?: DocumentThumbnailOptions & DocumentQueryOptions,
  ): Promise<HTMLCanvasElement>;
  annotations(): readonly PdfAnnotation[];
}

interface CreateDocumentQueryOptions {
  readonly filePath: string;
  readonly generation: number;
  readonly runtime: DocumentRuntime;
  readonly isCurrent: () => boolean;
}

const cloneAnnotations = (annotations: readonly PdfAnnotation[]): PdfAnnotation[] =>
  annotations.map((annotation) => ({
    ...annotation,
    rects: annotation.rects.map((rect) => ({ ...rect })),
  }));

const cloneOutline = (items: readonly PdfOutlineItem[]): PdfOutlineItem[] =>
  items.map((item) => ({
    ...item,
    items: cloneOutline(item.items),
  }));

const cloneSearchProgress = (progress: SearchProgress): SearchProgress => ({
  pageNumber: progress.pageNumber,
  totalPages: progress.totalPages,
  pageMatches: progress.pageMatches.map((match) => ({ ...match })),
  matches: progress.matches.map((match) => ({ ...match })),
});

export function createDocumentQuery({
  filePath,
  generation,
  runtime,
  isCurrent,
}: CreateDocumentQueryOptions): DocumentQuery {
  const cancelled = (options?: DocumentQueryOptions): boolean =>
    !isCurrent() || Boolean(options?.isCancelled?.());

  return {
    filePath,
    generation,
    isCurrent,
    async search(query, options = {}) {
      if (cancelled(options)) return [];
      const matches = await runtime.content.search(query, {
        isCancelled: () => cancelled(options),
        ...(options.onProgress
          ? {
              onProgress: (progress: SearchProgress) => {
                if (!cancelled(options)) options.onProgress?.(cloneSearchProgress(progress));
              },
            }
          : {}),
      });
      return cancelled(options) ? [] : matches.map((match) => ({ ...match }));
    },
    async outline(options = {}) {
      if (cancelled(options)) return [];
      const outline = await runtime.content.getOutline({
        isCancelled: () => cancelled(options),
      });
      return cancelled(options) ? [] : cloneOutline(outline);
    },
    async metadata(options = {}) {
      if (cancelled(options)) return null;
      const metadata = await runtime.content.getMetadata({
        isCancelled: () => cancelled(options),
      });
      return cancelled(options) || !metadata
        ? null
        : { ...metadata, keywords: [...metadata.keywords] };
    },
    async resolveLinkTarget(target, options = {}) {
      if (cancelled(options)) return null;
      const resolved = await runtime.content.resolveLinkTarget(target, {
        isCancelled: () => cancelled(options),
      });
      return cancelled(options) ? null : resolved;
    },
    async thumbnail(pageNumber, options = {}) {
      if (cancelled(options)) throw new Error('Document Query generation is no longer current');
      const canvas = await runtime.renderThumbnail(pageNumber, options);
      if (cancelled(options)) throw new Error('Document Query generation is no longer current');
      return canvas;
    },
    annotations() {
      return isCurrent() ? cloneAnnotations(runtime.getAnnotations()) : [];
    },
  };
}
