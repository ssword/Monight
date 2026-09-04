// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { SearchProgress } from '../lib/document-features';
import type {
  DocumentContent,
  DocumentContentMetadata,
  ResolvedDocumentLinkTarget,
} from '../reader/document-content';
import type { DocumentRuntime } from '../reader/document-queries';
import { createReaderActions } from '../reader/reader-actions';

const FIRST_DOCUMENT = {
  filePath: '/docs/first.pdf',
  title: 'first.pdf',
  readingPosition: { page: 1, location: 0 },
} as const;

function createContent(overrides: Partial<DocumentContent> = {}): DocumentContent {
  return {
    pageCount: 3,
    getPage: vi.fn(),
    getData: vi.fn(async () => new Uint8Array([1, 2, 3])),
    search: vi.fn(async () => []),
    getOutline: vi.fn(async () => []),
    getMetadata: vi.fn(
      async (): Promise<DocumentContentMetadata> => ({
        title: 'First',
        author: 'Monight',
        subject: null,
        keywords: [],
        pageCount: 3,
      }),
    ),
    resolveLinkTarget: vi.fn(
      async (): Promise<ResolvedDocumentLinkTarget | null> => ({
        kind: 'page',
        pageNumber: 2,
      }),
    ),
    destroy: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createRuntime(content = createContent()): DocumentRuntime {
  let destroyed = false;
  return {
    content,
    destroy: vi.fn(async () => {
      if (destroyed) return;
      destroyed = true;
      await content.destroy();
    }),
    renderThumbnail: vi.fn(async () => document.createElement('canvas')),
    getAnnotations: vi.fn(() => []),
  };
}

function createReader() {
  return createReaderActions({
    initialSession: {
      schemaVersion: 2,
      activeDocumentPath: FIRST_DOCUMENT.filePath,
      documents: [FIRST_DOCUMENT],
    },
    projection: {
      activateDocument: vi.fn(),
      goToReadingPosition: vi.fn(),
      closeDocument: vi.fn(),
    },
    persist: vi.fn(),
  });
}

describe('Document Queries', () => {
  it('exposes content, thumbnail, metadata, link-target, and Annotation reads without committing state', async () => {
    const reader = createReader();
    const runtime = createRuntime();
    await reader.dispatch({ type: 'registerDocument', document: FIRST_DOCUMENT, runtime });
    const before = reader.snapshot();
    const query = reader.query(FIRST_DOCUMENT.filePath);

    expect(query).not.toBeNull();
    await expect(query?.search('moon')).resolves.toEqual([]);
    await expect(query?.outline()).resolves.toEqual([]);
    await expect(query?.metadata()).resolves.toMatchObject({ title: 'First', pageCount: 3 });
    await expect(query?.resolveLinkTarget({ dest: 'chapter-2' })).resolves.toEqual({
      kind: 'page',
      pageNumber: 2,
    });
    await expect(query?.thumbnail(1)).resolves.toBeInstanceOf(HTMLCanvasElement);
    expect(query?.annotations()).toEqual([]);
    expect(reader.snapshot()).toEqual(before);
  });

  it('invalidates a generation immediately when its Document closes and ignores late results', async () => {
    let finishSearch: ((matches: []) => void) | undefined;
    let emitProgress: (() => void) | undefined;
    const onProgress = vi.fn();
    const content = createContent({
      search: vi.fn(
        async (_query, options) =>
          new Promise<[]>((resolve) => {
            emitProgress = () =>
              options.onProgress?.({
                pageNumber: 1,
                totalPages: 3,
                pageMatches: [],
                matches: [],
              });
            finishSearch = resolve;
          }),
      ),
    });
    const reader = createReader();
    await reader.dispatch({
      type: 'registerDocument',
      document: FIRST_DOCUMENT,
      runtime: createRuntime(content),
    });
    const query = reader.query(FIRST_DOCUMENT.filePath);
    const search = query?.search('moon', { onProgress });
    await vi.waitFor(() => expect(content.search).toHaveBeenCalledOnce());

    const closing = reader.dispatch({ type: 'closeDocument', filePath: FIRST_DOCUMENT.filePath });
    expect(query?.isCurrent()).toBe(false);
    emitProgress?.();
    finishSearch?.([]);

    await expect(search).resolves.toEqual([]);
    expect(onProgress).not.toHaveBeenCalled();
    await closing;
    expect(content.destroy).toHaveBeenCalledOnce();
  });

  it('cancels a query when its caller cancels without changing the runtime generation', async () => {
    let cancelled = false;
    const content = createContent({
      search: vi.fn(async (_query, options) => {
        cancelled = true;
        return options.isCancelled()
          ? []
          : [{ pageNumber: 1, pageOccurrence: 0, index: 0, excerpt: 'moon' }];
      }),
    });
    const reader = createReader();
    await reader.dispatch({
      type: 'registerDocument',
      document: FIRST_DOCUMENT,
      runtime: createRuntime(content),
    });
    const query = reader.query(FIRST_DOCUMENT.filePath);

    await expect(query?.search('moon', { isCancelled: () => cancelled })).resolves.toEqual([]);
    expect(query?.isCurrent()).toBe(true);
  });

  it('clones incremental search progress before exposing it to callers', async () => {
    const match = { pageNumber: 1, pageOccurrence: 0, index: 0, excerpt: 'moon' };
    const progress: SearchProgress = {
      pageNumber: 1,
      totalPages: 3,
      pageMatches: [match],
      matches: [match],
    };
    const content = createContent({
      search: vi.fn(async (_query, options) => {
        options.onProgress?.(progress);
        return [match];
      }),
    });
    const reader = createReader();
    await reader.dispatch({
      type: 'registerDocument',
      document: FIRST_DOCUMENT,
      runtime: createRuntime(content),
    });
    const onProgress = vi.fn((value: SearchProgress) => {
      value.matches[0].excerpt = 'changed';
      value.pageMatches.length = 0;
    });

    await reader.query(FIRST_DOCUMENT.filePath)?.search('moon', { onProgress });

    expect(progress.matches[0].excerpt).toBe('moon');
    expect(progress.pageMatches).toHaveLength(1);
  });

  it('owns exactly one live Document Content instance per open Document', async () => {
    const reader = createReader();
    const first = createRuntime();
    const duplicate = createRuntime();

    await expect(
      reader.dispatch({ type: 'registerDocument', document: FIRST_DOCUMENT, runtime: first }),
    ).resolves.toMatchObject({ status: 'no-op' });
    await expect(
      reader.dispatch({ type: 'registerDocument', document: FIRST_DOCUMENT, runtime: duplicate }),
    ).resolves.toMatchObject({ status: 'failure' });

    expect(first.content.destroy).not.toHaveBeenCalled();
    expect(duplicate.content.destroy).toHaveBeenCalledOnce();
  });

  it('rejects an old query after replacement and binds a new handle to the new generation', async () => {
    const reader = createReader();
    const first = createRuntime();
    await reader.dispatch({ type: 'registerDocument', document: FIRST_DOCUMENT, runtime: first });
    const oldQuery = reader.query(FIRST_DOCUMENT.filePath);

    await reader.dispatch({ type: 'removeDocument', filePath: FIRST_DOCUMENT.filePath });
    const second = createRuntime();
    await reader.dispatch({ type: 'registerDocument', document: FIRST_DOCUMENT, runtime: second });
    const newQuery = reader.query(FIRST_DOCUMENT.filePath);

    expect(oldQuery?.isCurrent()).toBe(false);
    expect(newQuery?.isCurrent()).toBe(true);
    expect(newQuery?.generation).not.toBe(oldQuery?.generation);
  });

  it('keeps old handles invalid after a failed close while allowing a new generation', async () => {
    const reader = createReaderActions({
      initialSession: {
        schemaVersion: 2,
        activeDocumentPath: FIRST_DOCUMENT.filePath,
        documents: [FIRST_DOCUMENT],
      },
      projection: {
        activateDocument: vi.fn(),
        goToReadingPosition: vi.fn(),
        closeDocument: vi.fn(async () => {
          throw new Error('surface refused to close');
        }),
      },
      persist: vi.fn(),
    });
    await reader.dispatch({
      type: 'registerDocument',
      document: FIRST_DOCUMENT,
      runtime: createRuntime(),
    });
    const oldQuery = reader.query(FIRST_DOCUMENT.filePath);

    await expect(
      reader.dispatch({ type: 'closeDocument', filePath: FIRST_DOCUMENT.filePath }),
    ).resolves.toMatchObject({ status: 'failure' });
    const newQuery = reader.query(FIRST_DOCUMENT.filePath);

    expect(oldQuery?.isCurrent()).toBe(false);
    expect(newQuery?.isCurrent()).toBe(true);
    expect(newQuery?.generation).not.toBe(oldQuery?.generation);
  });
});
