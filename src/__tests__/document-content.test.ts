import { describe, expect, it, vi } from 'vitest';
import { createPdfDocumentContent } from '../reader/pdf-document-content';

describe('PDF Document Content', () => {
  it('owns loading and caches PDF-authored query data', async () => {
    const firstText = vi.fn(async () => ({ items: [{ str: 'moon light' }] }));
    const secondText = vi.fn(async () => ({ items: [{ str: 'moon night' }] }));
    const pages = [{ getTextContent: firstText }, { getTextContent: secondText }];
    const pdfDocument = {
      numPages: 2,
      getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1]),
      getOutline: vi.fn(async () => [
        {
          title: 'Chapter',
          bold: false,
          italic: false,
          dest: [0],
          url: null,
          items: [],
        },
      ]),
      getMetadata: vi.fn(async () => ({
        info: {
          Title: 'Moon',
          Author: 'Night',
          Subject: 'Reading',
          Keywords: 'pdf, reader',
        },
      })),
      getDestination: vi.fn(async () => [{ num: 8, gen: 0 }]),
      getPageIndex: vi.fn(async () => 1),
      getData: vi.fn(async () => new Uint8Array([4, 5, 6])),
      destroy: vi.fn(async () => undefined),
    };
    const getDocument = vi.fn(() => ({ promise: Promise.resolve(pdfDocument) }));
    const content = createPdfDocumentContent({
      loadEngine: async () => ({
        getDocument,
        PasswordResponses: { INCORRECT_PASSWORD: 2 },
      }),
    });

    await content.load({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: 'moon.pdf',
      filePath: '/docs/moon.pdf',
    });
    await expect(content.search('moon', { isCancelled: () => false })).resolves.toHaveLength(2);
    await expect(content.search('night', { isCancelled: () => false })).resolves.toHaveLength(1);
    await expect(content.getOutline({ isCancelled: () => false })).resolves.toEqual([
      expect.objectContaining({ title: 'Chapter', pageNumber: 1 }),
    ]);
    await content.getOutline({ isCancelled: () => false });
    await expect(content.getMetadata({ isCancelled: () => false })).resolves.toEqual({
      title: 'Moon',
      author: 'Night',
      subject: 'Reading',
      keywords: ['pdf', 'reader'],
      pageCount: 2,
    });
    await content.getMetadata({ isCancelled: () => false });
    await expect(
      content.resolveLinkTarget({ dest: 'chapter' }, { isCancelled: () => false }),
    ).resolves.toEqual({ kind: 'page', pageNumber: 2 });
    await expect(
      content.resolveLinkTarget({ url: 'https://example.com' }, { isCancelled: () => false }),
    ).resolves.toEqual({ kind: 'external', url: 'https://example.com' });
    await expect(content.getData()).resolves.toEqual(new Uint8Array([4, 5, 6]));

    expect(getDocument).toHaveBeenCalledOnce();
    expect(firstText).toHaveBeenCalledOnce();
    expect(secondText).toHaveBeenCalledOnce();
    expect(pdfDocument.getOutline).toHaveBeenCalledOnce();
    expect(pdfDocument.getMetadata).toHaveBeenCalledOnce();

    await content.destroy();
    await expect(content.getPage(1)).rejects.toThrow('Document Content is not loaded');
    expect(pdfDocument.destroy).toHaveBeenCalledOnce();
  });

  it('cancels an in-flight load without allowing its PDF document to become live later', async () => {
    let finishLoad: ((document: typeof pdfDocument) => void) | undefined;
    const pdfDocument = {
      numPages: 1,
      getPage: vi.fn(async () => ({})),
      getOutline: vi.fn(async () => []),
      getMetadata: vi.fn(async () => ({})),
      getDestination: vi.fn(async () => null),
      getPageIndex: vi.fn(async () => 0),
      getData: vi.fn(async () => new Uint8Array()),
      destroy: vi.fn(async () => undefined),
    };
    const destroyLoadingTask = vi.fn(async () => undefined);
    const content = createPdfDocumentContent({
      loadEngine: async () => ({
        getDocument: () => ({
          promise: new Promise<typeof pdfDocument>((resolve) => {
            finishLoad = resolve;
          }),
          destroy: destroyLoadingTask,
        }),
        PasswordResponses: { INCORRECT_PASSWORD: 2 },
      }),
    });

    const loading = content.load({
      bytes: new Uint8Array([1]),
      fileName: 'moon.pdf',
      filePath: '/docs/moon.pdf',
    });
    await vi.waitFor(() => expect(finishLoad).toBeTypeOf('function'));
    await content.destroy();
    finishLoad?.(pdfDocument);

    await expect(loading).rejects.toThrow('Document Content load cancelled');
    expect(destroyLoadingTask).toHaveBeenCalledOnce();
    expect(pdfDocument.destroy).toHaveBeenCalledOnce();
    expect(content.pageCount).toBe(0);
  });
});
