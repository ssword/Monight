import type { DocumentQuery } from './document-queries';
import type { DocumentRenderingState } from './document-rendering';

export interface DocumentPresentation {
  snapshot(): DocumentRenderingState;
  openSearch?(): void;
}

export interface DocumentAccess {
  readonly query: DocumentQuery;
  readonly presentation: DocumentPresentation;
}
