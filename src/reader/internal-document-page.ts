const documentPageHandles = new WeakMap<DocumentPage, unknown>();
declare const documentPageBrand: unique symbol;

export interface DocumentPage {
  readonly pageNumber: number;
  readonly [documentPageBrand]: true;
}

export function createInternalDocumentPage(
  pageNumber: number,
  renderingHandle: unknown,
): DocumentPage {
  const page = Object.freeze({ pageNumber }) as DocumentPage;
  documentPageHandles.set(page, renderingHandle);
  return page;
}

export function getInternalDocumentPageRenderingHandle(page: DocumentPage): unknown {
  const handle = documentPageHandles.get(page);
  if (!handle) throw new Error('Document Page does not have a rendering handle');
  return handle;
}
