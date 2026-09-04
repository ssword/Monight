import type { PdfOutlineItem, PdfSearchMatch, SearchProgress } from '../lib/document-features';
import type { PdfLinkTarget } from '../lib/pdf-links';
import type { DocumentPage } from './internal-document-page';

export type { DocumentPage } from './internal-document-page';

export interface DocumentContentMetadata {
  readonly title: string | null;
  readonly author: string | null;
  readonly subject: string | null;
  readonly keywords: readonly string[];
  readonly pageCount: number;
}

export type ResolvedDocumentLinkTarget =
  | { readonly kind: 'page'; readonly pageNumber: number }
  | { readonly kind: 'external'; readonly url: string };

export interface DocumentContentQueryOptions {
  readonly isCancelled: () => boolean;
}

export interface DocumentSearchOptions extends DocumentContentQueryOptions {
  readonly onProgress?: (progress: SearchProgress) => void;
}

export interface DocumentContent {
  readonly pageCount: number;
  getPage(pageNumber: number): Promise<DocumentPage>;
  getData(): Promise<Uint8Array>;
  search(query: string, options: DocumentSearchOptions): Promise<readonly PdfSearchMatch[]>;
  getOutline(options: DocumentContentQueryOptions): Promise<readonly PdfOutlineItem[]>;
  getMetadata(options: DocumentContentQueryOptions): Promise<DocumentContentMetadata | null>;
  resolveLinkTarget(
    target: PdfLinkTarget,
    options: DocumentContentQueryOptions,
  ): Promise<ResolvedDocumentLinkTarget | null>;
  destroy(): void | Promise<void>;
}

export type PdfPasswordRequester = (
  fileName: string,
  reason: 'required' | 'incorrect',
) => Promise<string | null>;

export interface DocumentContentLoadRequest {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly filePath: string;
}

export interface LoadableDocumentContent extends DocumentContent {
  load(request: DocumentContentLoadRequest): Promise<void>;
}
