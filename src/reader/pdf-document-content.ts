import {
  type PdfOutlineItem,
  type PdfSearchMatch,
  searchDocumentIncrementally,
} from '../lib/document-features';
import { getPdfEngine } from '../lib/pdf-engine';
import type { PdfDestination, PdfLinkTarget } from '../lib/pdf-links';
import type {
  DocumentContentMetadata,
  DocumentContentQueryOptions,
  DocumentSearchOptions,
  LoadableDocumentContent,
  PdfPasswordRequester,
} from './document-content';
import { createInternalDocumentPage } from './internal-document-page';

interface RawOutlineItem {
  readonly title?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly dest?: PdfDestination | null;
  readonly url?: string | null;
  readonly unsafeUrl?: string;
  readonly items?: readonly RawOutlineItem[];
}

interface PdfDocumentLike {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<unknown>;
  getOutline(): Promise<unknown>;
  getMetadata(): Promise<unknown>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(reference: { num: number; gen: number }): Promise<number>;
  getData(): Promise<Uint8Array>;
  destroy(): Promise<void>;
}

interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
  onPassword?: (updatePassword: (password: string) => void, reason: number) => void;
  destroy?: () => Promise<void>;
}

interface PdfEngineLike {
  getDocument(options: { data: Uint8Array }): PdfLoadingTaskLike;
  PasswordResponses: { INCORRECT_PASSWORD: number };
}

interface CreatePdfDocumentContentOptions {
  readonly requestPassword?: PdfPasswordRequester;
  readonly loadEngine?: () => Promise<PdfEngineLike>;
}

function releasePdfData(bytes: Uint8Array): void {
  try {
    globalThis.structuredClone(bytes, { transfer: [bytes.buffer] });
  } catch {
    bytes.fill(0);
  }
}

function cloneOutline(items: readonly PdfOutlineItem[]): PdfOutlineItem[] {
  return items.map((item) => ({
    ...item,
    items: cloneOutline(item.items),
  }));
}

function readMetadataText(info: Record<string, unknown>, key: string): string | null {
  const value = info[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readMetadataKeywords(info: Record<string, unknown>): string[] {
  const keywords = readMetadataText(info, 'Keywords');
  return keywords
    ? keywords
        .split(/[,;]/)
        .map((keyword) => keyword.trim())
        .filter(Boolean)
    : [];
}

function isPageReference(value: unknown): value is { num: number; gen: number } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'num' in value &&
      'gen' in value &&
      typeof (value as { num?: unknown }).num === 'number' &&
      typeof (value as { gen?: unknown }).gen === 'number',
  );
}

export function createPdfDocumentContent({
  requestPassword,
  loadEngine = async () => (await getPdfEngine()) as unknown as PdfEngineLike,
}: CreatePdfDocumentContentOptions = {}): LoadableDocumentContent {
  let pdfDocument: PdfDocumentLike | null = null;
  let loadingTask: PdfLoadingTaskLike | null = null;
  let loadGeneration = 0;
  const pageTextCache = new Map<number, string>();
  let outlineCache: readonly PdfOutlineItem[] | null = null;
  let metadataCache: DocumentContentMetadata | null = null;

  const currentDocument = (): PdfDocumentLike => {
    if (!pdfDocument) throw new Error('Document Content is not loaded');
    return pdfDocument;
  };

  const resolveDestinationPage = async (
    destination: PdfDestination,
    options: DocumentContentQueryOptions,
  ): Promise<number | null> => {
    const document = currentDocument();
    const explicitDestination = Array.isArray(destination)
      ? destination
      : await document.getDestination(destination);
    if (options.isCancelled() || pdfDocument !== document || !explicitDestination?.length) {
      return null;
    }

    const pageReference = explicitDestination[0];
    if (typeof pageReference === 'number') {
      return Math.max(1, Math.min(pageReference + 1, document.numPages));
    }
    if (!isPageReference(pageReference)) return null;
    const pageIndex = await document.getPageIndex(pageReference);
    if (options.isCancelled() || pdfDocument !== document) return null;
    return Math.max(1, Math.min(pageIndex + 1, document.numPages));
  };

  const getPageText = async (pageNumber: number): Promise<string> => {
    const cached = pageTextCache.get(pageNumber);
    if (cached !== undefined) return cached;
    const document = currentDocument();
    const page = (await document.getPage(pageNumber)) as {
      getTextContent(): Promise<{ items: readonly unknown[] }>;
    };
    const content = await page.getTextContent();
    if (pdfDocument !== document) return '';
    const text = content.items
      .map((item) =>
        item &&
        typeof item === 'object' &&
        'str' in item &&
        typeof (item as { str?: unknown }).str === 'string'
          ? (item as { str: string }).str
          : '',
      )
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pageTextCache.set(pageNumber, text);
    return text;
  };

  return {
    get pageCount() {
      return pdfDocument?.numPages ?? 0;
    },
    async load({ bytes, fileName }) {
      if (pdfDocument || loadingTask) throw new Error('Document Content is already loaded');
      const expectedLoadGeneration = ++loadGeneration;
      let passwordCancelled = false;
      let passwordRequestError: unknown = null;
      const engine = await loadEngine();
      if (expectedLoadGeneration !== loadGeneration) {
        throw new Error('Document Content load cancelled');
      }
      const currentLoadingTask = engine.getDocument({ data: bytes.slice() });
      loadingTask = currentLoadingTask;
      releasePdfData(bytes);
      if (requestPassword) {
        currentLoadingTask.onPassword = (updatePassword, reason) => {
          const requestReason =
            reason === engine.PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required';
          void requestPassword(fileName, requestReason)
            .then(async (password) => {
              if (password === null) {
                passwordCancelled = true;
                await currentLoadingTask.destroy?.();
                return;
              }
              updatePassword(password);
            })
            .catch(async (error) => {
              passwordRequestError = error;
              await currentLoadingTask.destroy?.().catch(() => undefined);
            });
        };
      }
      try {
        const loadedDocument = await currentLoadingTask.promise;
        if (expectedLoadGeneration !== loadGeneration || loadingTask !== currentLoadingTask) {
          await loadedDocument.destroy().catch(() => undefined);
          throw new Error('Document Content load cancelled');
        }
        pdfDocument = loadedDocument;
      } catch (error) {
        if (expectedLoadGeneration !== loadGeneration || loadingTask !== currentLoadingTask) {
          throw new Error('Document Content load cancelled');
        }
        if (passwordCancelled) throw new Error('Password entry cancelled');
        if (passwordRequestError) {
          throw new Error(
            `Password prompt failed: ${
              passwordRequestError instanceof Error
                ? passwordRequestError.message
                : String(passwordRequestError)
            }`,
          );
        }
        throw new Error(
          `Failed to load PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      } finally {
        if (loadingTask === currentLoadingTask) loadingTask = null;
      }
    },
    async getPage(pageNumber) {
      return createInternalDocumentPage(pageNumber, await currentDocument().getPage(pageNumber));
    },
    async getData() {
      return currentDocument().getData();
    },
    async search(
      query: string,
      options: DocumentSearchOptions,
    ): Promise<readonly PdfSearchMatch[]> {
      const document = currentDocument();
      const matches = await searchDocumentIncrementally({
        query,
        totalPages: document.numPages,
        getPageText,
        isCancelled: () => options.isCancelled() || pdfDocument !== document,
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      });
      return options.isCancelled() || pdfDocument !== document ? [] : matches;
    },
    async getOutline(options) {
      if (options.isCancelled()) return [];
      if (outlineCache) return cloneOutline(outlineCache);
      const document = currentDocument();
      const rawOutline = (await document.getOutline()) as readonly RawOutlineItem[] | null;
      if (options.isCancelled() || pdfDocument !== document) return [];

      const resolveItems = async (items: readonly RawOutlineItem[]): Promise<PdfOutlineItem[]> =>
        Promise.all(
          items.map(async (item) => ({
            title: item.title?.trim() || 'Untitled section',
            pageNumber: item.dest ? await resolveDestinationPage(item.dest, options) : null,
            ...((item.url ?? item.unsafeUrl) ? { url: item.url ?? item.unsafeUrl } : {}),
            bold: Boolean(item.bold),
            italic: Boolean(item.italic),
            items: await resolveItems(item.items ?? []),
          })),
        );
      const outline = await resolveItems(rawOutline ?? []);
      if (options.isCancelled() || pdfDocument !== document) return [];
      outlineCache = outline;
      return cloneOutline(outline);
    },
    async getMetadata(options) {
      if (options.isCancelled()) return null;
      if (metadataCache) return { ...metadataCache, keywords: [...metadataCache.keywords] };
      const document = currentDocument();
      const raw = (await document.getMetadata()) as { info?: unknown };
      if (options.isCancelled() || pdfDocument !== document) return null;
      const info =
        raw.info && typeof raw.info === 'object' ? (raw.info as Record<string, unknown>) : {};
      metadataCache = {
        title: readMetadataText(info, 'Title'),
        author: readMetadataText(info, 'Author'),
        subject: readMetadataText(info, 'Subject'),
        keywords: readMetadataKeywords(info),
        pageCount: document.numPages,
      };
      return { ...metadataCache, keywords: [...metadataCache.keywords] };
    },
    async resolveLinkTarget(target: PdfLinkTarget, options) {
      if (target.url) {
        return options.isCancelled() ? null : { kind: 'external', url: target.url };
      }
      if (!target.dest) return null;
      const pageNumber = await resolveDestinationPage(target.dest, options);
      return pageNumber === null ? null : { kind: 'page', pageNumber };
    },
    async destroy() {
      loadGeneration += 1;
      const task = loadingTask;
      loadingTask = null;
      const document = pdfDocument;
      pdfDocument = null;
      pageTextCache.clear();
      outlineCache = null;
      metadataCache = null;
      await task?.destroy?.().catch(() => undefined);
      await document?.destroy();
    },
  };
}
