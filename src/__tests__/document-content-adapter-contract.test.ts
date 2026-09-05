import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentContentLoadRequest,
  DocumentContentMetadata,
  LoadableDocumentContent,
  ResolvedDocumentLinkTarget,
} from '../reader/document-content';
import { createInternalDocumentPage } from '../reader/internal-document-page';
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
      const page = await content.getPage(2);
      const matches = await content.search('moon', { isCancelled: () => false });
      const outline = await content.getOutline({ isCancelled: () => false });
      const returnedMetadata = await content.getMetadata({ isCancelled: () => false });
      const internalTarget = await content.resolveLinkTarget(
        { dest: 'chapter' },
        { isCancelled: () => false },
      );
      const externalTarget = await content.resolveLinkTarget(
        { url: 'https://example.com/report' },
        { isCancelled: () => false },
      );
      returnedBytes[0] = 99;

      expect(content.pageCount).toBe(2);
      expect(page.pageNumber).toBe(2);
      expect(matches).toEqual([
        { pageNumber: 1, pageOccurrence: 0, index: 0, excerpt: 'moon light' },
      ]);
      expect(outline).toEqual([
        {
          title: 'Chapter',
          pageNumber: 2,
          bold: false,
          italic: false,
          items: [],
        },
      ]);
      expect(await content.getData()).toEqual(new Uint8Array([7, 8, 9]));
      expect(returnedMetadata).toEqual(metadata);
      expect(internalTarget).toEqual({ kind: 'page', pageNumber: 2 });
      expect(externalTarget).toEqual({ kind: 'external', url: 'https://example.com/report' });
      await expect(content.search('moon', { isCancelled: () => true })).resolves.toEqual([]);
      await expect(content.getOutline({ isCancelled: () => true })).resolves.toEqual([]);
      await expect(content.getMetadata({ isCancelled: () => true })).resolves.toBeNull();
      await expect(
        content.resolveLinkTarget({ dest: 'chapter' }, { isCancelled: () => true }),
      ).resolves.toBeNull();

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
    async getPage(pageNumber) {
      if (!loaded) throw new Error('Document Content is not loaded');
      return createInternalDocumentPage(pageNumber, { pageNumber });
    },
    async getData() {
      if (!loaded) throw new Error('Document Content is not loaded');
      return data.slice();
    },
    async search(query, options) {
      return loaded && !options.isCancelled() && query === 'moon'
        ? [{ pageNumber: 1, pageOccurrence: 0, index: 0, excerpt: 'moon light' }]
        : [];
    },
    async getOutline(options) {
      return loaded && !options.isCancelled()
        ? [
            {
              title: 'Chapter',
              pageNumber: 2,
              bold: false,
              italic: false,
              items: [],
            },
          ]
        : [];
    },
    async getMetadata(options) {
      return options.isCancelled() || !loaded
        ? null
        : { ...metadata, keywords: [...metadata.keywords] };
    },
    async resolveLinkTarget(target, options): Promise<ResolvedDocumentLinkTarget | null> {
      if (!loaded || options.isCancelled()) return null;
      if (target.url) return { kind: 'external', url: target.url };
      return target.dest ? { kind: 'page', pageNumber: 2 } : null;
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
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: async () => ({
          items: [{ str: pageNumber === 1 ? 'moon light' : 'night sky' }],
        }),
      })),
      getOutline: vi.fn(async () => [
        {
          title: 'Chapter',
          bold: false,
          italic: false,
          dest: 'chapter',
          items: [],
        },
      ]),
      getMetadata: vi.fn(async () => ({
        info: {
          Title: metadata.title,
          Author: metadata.author,
          Subject: metadata.subject,
          Keywords: metadata.keywords.join(', '),
        },
      })),
      getDestination: vi.fn(async () => [1]),
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
