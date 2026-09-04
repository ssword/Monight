export interface DocumentMetadata {
  readonly canonicalPath: string;
  readonly title: string;
}

export interface PdfSource {
  describe(requestedPath: string): Promise<DocumentMetadata>;
  read(canonicalPath: string): Promise<Uint8Array>;
}

export interface InMemoryPdfDocument extends DocumentMetadata {
  readonly requestedPaths?: readonly string[];
  readonly bytes: Uint8Array;
}

export function createInMemoryPdfSource(documents: readonly InMemoryPdfDocument[]): PdfSource {
  const metadataByRequestedPath = new Map<string, DocumentMetadata>();
  const bytesByCanonicalPath = new Map<string, Uint8Array>();

  for (const document of documents) {
    const metadata = {
      canonicalPath: document.canonicalPath,
      title: document.title,
    };
    metadataByRequestedPath.set(document.canonicalPath, metadata);
    for (const requestedPath of document.requestedPaths ?? []) {
      metadataByRequestedPath.set(requestedPath, metadata);
    }
    bytesByCanonicalPath.set(document.canonicalPath, document.bytes.slice());
  }

  return {
    async describe(requestedPath) {
      const metadata = metadataByRequestedPath.get(requestedPath);
      if (!metadata) throw new Error(`Unknown Document path: ${requestedPath}`);
      return metadata;
    },
    async read(canonicalPath) {
      const bytes = bytesByCanonicalPath.get(canonicalPath);
      if (!bytes) throw new Error(`Unknown canonical Document path: ${canonicalPath}`);
      return bytes.slice();
    },
  };
}
