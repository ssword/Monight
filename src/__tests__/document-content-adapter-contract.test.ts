import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentContentLoadRequest,
  DocumentContentMetadata,
  LoadableDocumentContent,
  ResolvedDocumentLinkTarget,
} from '../reader/document-content';
import { createPdfDocumentContent } from '../reader/pdf-document-content';

interface DocumentContentHarness {
  readonly content: LoadableDocumentContent;
  readonly loadRequest: DocumentContentLoadRequest;
}

const metadata: DocumentContentMetadata = {
  title: 'Contract Report',
  author: 'Monight',
  subject: 'Adapter verification',
  keywords: ['contract', 'pdf'],
  pageCount: 2,
};

function expectDocumentContentContract(
  name: string,
  createHarness: () => DocumentContentHarness,
): void {
  describe(name, () => {
    it('loads Document Content and exposes owned read-only results', async () => {
      const { content, loadRequest } = createHarness();

      await content.load(loadRequest);
      const returnedBytes = await content.getData();
      const returnedMetadata = await content.getMetadata({ isCancelled: () => false });
      const externalTarget = await content.resolveLinkTarget(
        { url: 'https://example.com/report' },
        { isCancelled: () => false },
      );
      returnedBytes[0] = 99;

      expect(content.pageCount).toBe(2);
      expect(await content.getData()).toEqual(new Uint8Array([7, 8, 9]));
      expect(returnedMetadata).toEqual(metadata);
      expect(externalTarget).toEqual({ kind: 'external', url: 'https://example.com/report' });

      await content.destroy();
      expect(content.pageCount).toBe(0);
    });
  });
}

function createInMemoryDocumentContent(): LoadableDocumentContent {
  let loaded = false;
  const data = new Uint8Array([7, 8, 9]);
  return {
    get pageCount() {
      return loaded ? metadata.pageCount : 0;
    },
    async load() {
      loaded = true;
    },
    async getPage() {
      throw new Error('Page rendering is outside this Document Content contract');
    },
    async getData() {
      if (!loaded) throw new Error('Document Content is not loaded');
      return data.slice();
    },
    async search() {
      return [];
    },
    async getOutline() {
      return [];
    },
    async getMetadata(options) {
      return options.isCancelled() || !loaded
        ? null
        : { ...metadata, keywords: [...metadata.keywords] };
    },
    async resolveLinkTarget(target, options): Promise<ResolvedDocumentLinkTarget | null> {
      if (!loaded || options.isCancelled() || !target.url) return null;
      return { kind: 'external', url: target.url };
    },
    destroy() {
      loaded = false;
    },
  };
}

describe('Document Content adapter contract', () => {
  expectDocumentContentContract('in-memory adapter', () => ({
    content: createInMemoryDocumentContent(),
    loadRequest: {
      bytes: new Uint8Array([1, 2, 3]),
      fileName: 'report.pdf',
      filePath: '/docs/report.pdf',
    },
  }));

  expectDocumentContentContract('PDF.js production adapter', () => {
    const pdfDocument = {
      numPages: 2,
      getPage: vi.fn(),
      getOutline: vi.fn(async () => []),
      getMetadata: vi.fn(async () => ({
        info: {
          Title: metadata.title,
          Author: metadata.author,
          Subject: metadata.subject,
          Keywords: metadata.keywords.join(', '),
        },
      })),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(),
      getData: vi.fn(async () => new Uint8Array([7, 8, 9])),
      destroy: vi.fn(async () => undefined),
    };
    return {
      content: createPdfDocumentContent({
        loadEngine: async () => ({
          getDocument: () => ({ promise: Promise.resolve(pdfDocument) }),
          PasswordResponses: { INCORRECT_PASSWORD: 2 },
        }),
      }),
      loadRequest: {
        bytes: new Uint8Array([1, 2, 3]),
        fileName: 'report.pdf',
        filePath: '/docs/report.pdf',
      },
    };
  });
});
