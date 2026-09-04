import type { DocumentQuery } from './document-queries';
import type { DocumentRendering } from './document-rendering';

export interface DocumentAccess {
  readonly query: DocumentQuery;
  readonly rendering: DocumentRendering;
}
