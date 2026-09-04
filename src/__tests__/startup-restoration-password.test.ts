// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPdfEngine = vi.hoisted(() => vi.fn());

vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

import { createDocumentIntakeRuntime } from '../app/document-intake-runtime';
import { restoreReadingSessionAtStartup } from '../app/startup-restoration';
import type { PersistedReadingSession, ReadingSessionDocument } from '../reader/reader-actions';
import { TabManager } from '../scripts/tabs';

function savedDocument(filePath: string, page: number): ReadingSessionDocument {
  return {
    filePath,
    title: filePath.split('/').pop() ?? filePath,
    readingPosition: { page, location: 0.25 },
    visualState: {
      filterSettings: {
        brightness: 0,
        grayscale: 0,
        invert: 100,
        sepia: 0,
        hue: 0,
        extraBrightness: 0,
      },
      zoomIntent: { kind: 'manual', scale: 1 },
      rotation: 0,
      viewMode: 'single',
    },
  };
}

describe('encrypted startup restoration', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tab-container" role="tablist" aria-label="Open documents"></div>
      <div id="document-workspace" role="tabpanel">
        <div id="pdf-container"></div>
      </div>
    `;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: '',
      })),
    });
  });

  it('cancels the password prompt, rolls back the Document, prunes it, and reports once', async () => {
    const loadError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const page = {
      getViewport: ({ scale = 1 }: { scale?: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        scale,
      }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getTextContent: async () => ({ items: [] }),
      getAnnotations: async () => [],
    };
    const loadedDocument = {
      numPages: 1,
      getPage: vi.fn(async () => page),
      destroy: vi.fn(),
    };
    const getDocument = vi.fn(({ data }: { data: Uint8Array }) => {
      if (data[0] !== 1) {
        return {
          onPassword: undefined,
          promise: Promise.resolve(loadedDocument),
          destroy: vi.fn(async () => undefined),
        };
      }

      let rejectDocument!: (error: Error) => void;
      const loadingTask = {
        onPassword: undefined as
          | ((updatePassword: (password: string) => void, reason: number) => void)
          | undefined,
        promise: new Promise<never>((_resolve, reject) => {
          rejectDocument = reject;
        }),
        destroy: vi.fn(async () => {
          rejectDocument(new Error('encrypted load destroyed'));
        }),
      };
      queueMicrotask(() => loadingTask.onPassword?.(vi.fn(), 1));
      return loadingTask;
    });
    getPdfEngine.mockResolvedValue({
      PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
      TextLayer: class {
        render = async () => {};
        cancel = vi.fn();
      },
      getDocument,
    });

    const requestPassword = vi.fn(async () => null);
    const manager = new TabManager(vi.fn(), undefined, undefined, { requestPassword });
    const intake = createDocumentIntakeRuntime({
      tabManager: manager,
      source: {
        describe: async (path) => ({
          canonicalPath: path,
          title: path.split('/').pop() ?? path,
        }),
        read: async (path) => new Uint8Array([path.includes('encrypted') ? 1 : 2]),
      },
      canonicalizeDocumentPaths: async () => undefined,
    });
    const session: PersistedReadingSession = {
      schemaVersion: 2,
      activeDocumentPath: '/docs/encrypted.pdf',
      documents: [savedDocument('/docs/encrypted.pdf', 2), savedDocument('/docs/kept.pdf', 1)],
    };
    const pruneDocument = vi.fn(async () => undefined);
    const reportFailure = vi.fn();

    const result = await restoreReadingSessionAtStartup({
      intake,
      session,
      pruneDocument,
      reportFailure,
    });

    expect(result.outcomes[1]).toMatchObject({ status: 'opened' });
    expect(result.failedPaths).toEqual(['/docs/encrypted.pdf']);
    expect(requestPassword).toHaveBeenCalledOnce();
    expect(requestPassword).toHaveBeenCalledWith('encrypted.pdf', 'required');
    expect(manager.getTabs().map(({ filePath }) => filePath)).toEqual(['/docs/kept.pdf']);
    expect(manager.getActiveTab()?.filePath).toBe('/docs/kept.pdf');
    expect(pruneDocument).toHaveBeenCalledOnce();
    expect(pruneDocument).toHaveBeenCalledWith('/docs/encrypted.pdf');
    expect(reportFailure).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledWith(
      'Pruned 1 saved Document while restoring the Reading Session.',
    );
    expect(loadError).toHaveBeenCalledWith('Error loading PDF:', expect.any(Error));
    loadError.mockRestore();
  });
});
