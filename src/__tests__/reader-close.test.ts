import { describe, expect, it, vi } from 'vitest';
import { createApplicationShutdownCoordinator } from '../app/window-lifecycle';
import type { DocumentRuntime } from '../reader/document-queries';
import type { NativePdfSaveAdapter } from '../reader/native-pdf-editing';
import {
  createReaderActions,
  type UnsavedDocumentChoice,
  type UnsavedDocumentRequest,
} from '../reader/reader-actions';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function workflow(options: {
  choose: (request: UnsavedDocumentRequest) => Promise<UnsavedDocumentChoice>;
  write?: NativePdfSaveAdapter['writeOriginal'];
  destination?: NativePdfSaveAdapter['chooseDestination'];
  beforeClose?: () => Promise<void>;
}) {
  const persisted: string[] = [];
  const removed: string[] = [];
  const reader = createReaderActions({
    initialSession: { schemaVersion: 2, documents: [], activeDocumentPath: null },
    chooseUnsavedDocument: options.choose,
    projection: {
      activateDocument: async () => undefined,
      goToReadingPosition: async () => undefined,
      verifySavedDocument: async () => undefined,
      reidentifyDocument: () => undefined,
      exitPresentation: async () => {
        await options.beforeClose?.();
        return undefined;
      },
      closeDocument: async (filePath) => {
        removed.push(filePath);
      },
    },
    pdfSaveAdapter: {
      captureSource: async (filePath) => filePath,
      writeOriginal:
        options.write ??
        (async (token, bytes) => {
          persisted.push(token);
          return bytes;
        }),
      chooseDestination: options.destination ?? (async () => null),
      writeDestination: async (destination, bytes) => {
        persisted.push(destination.canonicalPath);
        return bytes;
      },
      releaseDestination: async () => undefined,
    },
    persist: async () => undefined,
  });
  const open = async (filePath: string, dirty = true) => {
    let revision = dirty ? 1 : 0;
    let saved = 0;
    let destroyed = false;
    const runtime: DocumentRuntime = {
      saveSource: filePath,
      content: {
        pageCount: 10,
        getPage: async () => {
          throw new Error('No page in this viewer substitute');
        },
        getData: async () => new Uint8Array([1]),
        search: async () => [],
        getOutline: async () => [],
        getMetadata: async () => null,
        resolveLinkTarget: async () => null,
        destroy: async () => undefined,
      },
      renderThumbnail: async () => {
        throw new Error('No thumbnail in this viewer substitute');
      },
      destroy: async () => {
        destroyed = true;
      },
      editing: {
        state: () => ({ revision, dirty: revision !== saved, readOnlyReason: null }),
        exportPdf: async () => new Uint8Array([revision]),
        markSaved: (value) => {
          saved = value;
        },
      },
    };
    await reader.dispatch({
      type: 'registerDocument',
      activate: true,
      document: { filePath, title: filePath, readingPosition: { page: 1, location: 0 } },
      runtime,
    });
    return {
      edit: () => {
        revision += 1;
      },
      dirty: () => revision !== saved,
      destroyed: () => destroyed,
    };
  };
  return { reader, open, persisted, removed };
}

describe('unsaved Document close and Quit workflows', () => {
  it('waits for a pending save and coalesces repeated closes without another prompt or write', async () => {
    const write = deferred<Uint8Array>();
    let writes = 0;
    const app = await workflow({
      choose: async () => {
        throw new Error('Successful pending Save needs no prompt');
      },
      write: async () => {
        writes += 1;
        return write.promise;
      },
    });
    const document = await app.open('/first.pdf');
    const save = app.reader.dispatch({ type: 'saveDocument' });
    await vi.waitFor(() => expect(writes).toBe(1));
    const close = app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    const repeated = app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    expect(document.destroyed()).toBe(false);
    write.resolve(new Uint8Array([1]));
    await save;
    expect((await close).status).toBe('committed');
    expect(await repeated).toEqual(await close);
    expect(app.removed).toEqual(['/first.pdf']);
    expect(writes).toBe(1);
  });
  it.each([
    'cancel',
    'retry',
    'save-as-cancel',
    'save-as-success',
  ] as const)('retains edits after a failed close Save and supports %s', async (mode) => {
    const prompts: UnsavedDocumentRequest[] = [];
    let writes = 0;
    const app = await workflow({
      choose: async (request) => {
        prompts.push(request);
        if (!request.error) return 'save';
        if (mode === 'retry') return 'save';
        return mode === 'cancel' ? 'cancel' : 'save-as';
      },
      write: async (_token, bytes) => {
        if (++writes === 1) throw new Error('Source conflict');
        return bytes;
      },
      destination: async () =>
        mode === 'save-as-success'
          ? { canonicalPath: '/copy.pdf', title: 'copy.pdf', token: 'selected-copy' }
          : null,
    });
    const document = await app.open('/first.pdf');
    const result = await app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    expect(prompts.map(({ filePath }) => filePath)).toEqual(['/first.pdf', '/first.pdf']);
    expect(String(prompts[1].error)).toContain('Source conflict');
    if (mode === 'cancel' || mode === 'save-as-cancel') {
      expect(result.status).toBe('no-op');
      expect(document.dirty()).toBe(true);
      expect(document.destroyed()).toBe(false);
      expect(app.reader.isDocumentOpen('/first.pdf')).toBe(true);
      await app.reader.dispatch({ type: 'goToNextPage' });
      expect(app.reader.snapshot().documents[0].readingPosition.page).toBe(2);
    } else {
      expect(result.status).toBe('committed');
      expect(app.removed).toEqual([mode === 'retry' ? '/first.pdf' : '/copy.pdf']);
      expect(document.destroyed()).toBe(true);
    }
  });

  it('requires a fresh decision when edits arrive while a Discard prompt is open', async () => {
    const choice = deferred<UnsavedDocumentChoice>();
    let prompts = 0;
    const app = await workflow({
      choose: async () => (++prompts === 1 ? choice.promise : 'cancel'),
    });
    const document = await app.open('/first.pdf');
    const closing = app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    await vi.waitFor(() => expect(prompts).toBe(1));
    document.edit();
    choice.resolve('discard');
    expect((await closing).status).toBe('no-op');
    expect(prompts).toBe(2);
    expect(document.destroyed()).toBe(false);
    expect(document.dirty()).toBe(true);
  });

  it('keeps edits that arrive during a close Save and asks again before destruction', async () => {
    const write = deferred<Uint8Array>();
    let writes = 0;
    let prompts = 0;
    const app = await workflow({
      choose: async () => (++prompts === 1 ? 'save' : 'cancel'),
      write: async () => {
        writes += 1;
        return write.promise;
      },
    });
    const document = await app.open('/first.pdf');
    const closing = app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    await vi.waitFor(() => expect(writes).toBe(1));
    document.edit();
    write.resolve(new Uint8Array([1]));
    expect((await closing).status).toBe('no-op');
    expect(prompts).toBe(2);
    expect(document.dirty()).toBe(true);
    expect(document.destroyed()).toBe(false);
  });

  it('serializes a tab close with mixed native close/Quit requests and protects every Document', async () => {
    const choice = deferred<UnsavedDocumentChoice>();
    const prompts: string[] = [];
    const app = await workflow({
      choose: async ({ filePath }) => {
        prompts.push(filePath);
        return prompts.length === 1 ? choice.promise : 'save';
      },
    });
    await app.open('/first.pdf');
    await app.open('/second.pdf');
    const effects: string[] = [];
    const coordinator = createApplicationShutdownCoordinator({
      prepareShutdown: app.reader.prepareShutdown,
      canShutdown: app.reader.isShutdownPrepared,
      flush: app.reader.flush,
      closeMainWindow: async () => {
        effects.push('close');
      },
      quitApplication: async () => {
        effects.push('quit');
      },
      onShutdownCancelled: app.reader.cancelShutdown,
    });
    coordinator.markReady();
    const closing = app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    await vi.waitFor(() => expect(prompts).toEqual(['/first.pdf']));
    const closeMain = coordinator.request('close-main-window');
    const quit = coordinator.request('quit-application');
    choice.resolve('discard');
    await Promise.all([closing, closeMain, quit]);
    expect(prompts).toEqual(['/first.pdf', '/second.pdf']);
    expect(app.removed).toEqual(['/first.pdf']);
    expect(app.persisted).toEqual(['/second.pdf']);
    expect(effects).toEqual(['quit']);
  });

  it('cancels shutdown if a late edit invalidates Discard during session persistence', async () => {
    const app = await workflow({ choose: async () => 'discard' });
    const document = await app.open('/first.pdf');
    let closed = false;
    const coordinator = createApplicationShutdownCoordinator({
      prepareShutdown: app.reader.prepareShutdown,
      canShutdown: app.reader.isShutdownPrepared,
      flush: async () => {
        await app.reader.flush();
        document.edit();
      },
      closeMainWindow: async () => {
        closed = true;
      },
      quitApplication: async () => {
        closed = true;
      },
      onShutdownCancelled: app.reader.cancelShutdown,
    });
    coordinator.markReady();
    await coordinator.request('quit-application');
    expect(closed).toBe(false);
    expect(coordinator.isShutdownRequested()).toBe(false);
    expect(document.dirty()).toBe(true);
    expect(app.persisted).toEqual([]);
    await app.reader.dispatch({ type: 'goToNextPage' });
    expect(app.reader.snapshot().documents[0].readingPosition.page).toBe(2);
  });

  it('never applies a repeated old close to a reopened Document generation', async () => {
    const choice = deferred<UnsavedDocumentChoice>();
    let prompts = 0;
    const app = await workflow({
      choose: async () => {
        prompts += 1;
        return choice.promise;
      },
    });
    await app.open('/first.pdf');
    const oldQuery = app.reader.query();
    const closing = app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    const repeated = app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    await vi.waitFor(() => expect(prompts).toBe(1));
    choice.resolve('discard');
    await closing;
    const reopened = await app.open('/first.pdf');
    await repeated;
    expect(oldQuery?.isCurrent()).toBe(false);
    expect(app.reader.isDocumentOpen('/first.pdf')).toBe(true);
    expect(reopened.dirty()).toBe(true);
    expect(reopened.destroyed()).toBe(false);
    expect(prompts).toBe(1);
  });

  it('waits for an existing native Save As dialog before asking to close another Document', async () => {
    const destination = deferred<Awaited<ReturnType<NativePdfSaveAdapter['chooseDestination']>>>();
    let choosingDestination = false;
    let overlap = false;
    const app = await workflow({
      destination: async () => {
        choosingDestination = true;
        return destination.promise;
      },
      choose: async () => {
        overlap = choosingDestination;
        return 'cancel';
      },
    });
    await app.open('/first.pdf');
    await app.open('/second.pdf');
    const saving = app.reader.dispatch({ type: 'saveDocumentAs', filePath: '/first.pdf' });
    await vi.waitFor(() => expect(choosingDestination).toBe(true));
    const closing = app.reader.dispatch({ type: 'closeDocument', filePath: '/second.pdf' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    choosingDestination = false;
    destination.resolve(null);
    await Promise.all([saving, closing]);
    expect(overlap).toBe(false);
    expect(app.reader.snapshot().documents).toHaveLength(2);
  });
  it('coalesces repeated clean closes across a queued reopen of the same path', async () => {
    const closingProjection = deferred<void>();
    let entered = false;
    let armed = false;
    const app = await workflow({
      choose: async () => {
        throw new Error('Clean Documents need no prompt');
      },
      beforeClose: async () => {
        if (armed) {
          entered = true;
          await closingProjection.promise;
        }
      },
    });
    await app.open('/first.pdf', false);
    armed = true;
    const closing = app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    await vi.waitFor(() => expect(entered).toBe(true));
    const reopening = app.open('/first.pdf', false);
    const repeated = app.reader.dispatch({ type: 'closeDocument', filePath: '/first.pdf' });
    closingProjection.resolve();
    await Promise.all([closing, repeated]);
    const reopened = await reopening;
    expect(app.reader.isDocumentOpen('/first.pdf')).toBe(true);
    expect(reopened.destroyed()).toBe(false);
    expect(app.removed).toEqual(['/first.pdf']);
  });
});
