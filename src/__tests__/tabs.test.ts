// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPdfEngine = vi.hoisted(() => vi.fn());

vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

import type { ReadingSessionDocument } from '../reader/reader-actions';
import { PDFViewer } from '../scripts/pdf-viewer';
import { TabManager } from '../scripts/tabs';

function restoredDocument(filePath: string): ReadingSessionDocument {
  return {
    filePath,
    title: filePath.split('/').pop() ?? filePath,
    readingPosition: { page: 4, location: 0.6 },
    visualState: {
      filterSettings: {
        brightness: 8,
        grayscale: 100,
        invert: 92,
        sepia: 100,
        hue: 295,
        extraBrightness: -6,
      },
      zoomIntent: { kind: 'fit-width' },
      rotation: 90,
      viewMode: 'continuous',
    },
  };
}

describe('Document navigation', () => {
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
    getPdfEngine.mockResolvedValue({
      PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
      TextLayer: class {
        render = async () => {};
        cancel = vi.fn();
      },
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => page,
          destroy: vi.fn(),
        }),
      }),
    });
  });

  it('exposes a keyboard-operable tablist with one selected tab', async () => {
    const manager = new TabManager(vi.fn());
    await manager.createTab('/tmp/one.pdf', 'one.pdf', new Uint8Array([1]));
    await manager.createTab('/tmp/two.pdf', 'two.pdf', new Uint8Array([2]));

    const tablist = document.getElementById('tab-container');
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tablist?.getAttribute('role')).toBe('tablist');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[0].tabIndex).toBe(-1);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[1].getAttribute('aria-controls')).toBe('document-workspace');
    expect(tabs[1].dataset.filePath).toBe('/tmp/two.pdf');

    const workspace = document.getElementById('document-workspace');
    expect(workspace?.getAttribute('role')).toBe('tabpanel');
    expect(workspace?.getAttribute('aria-labelledby')).toBe(tabs[1].id);

    const closeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-close'));
    expect(closeButtons[0].parentElement).not.toBe(tabs[0]);
    expect(closeButtons[0].tabIndex).toBe(-1);
    expect(closeButtons[1].tabIndex).toBe(0);
  });

  it('registers a prepared Document before activation and notifies success afterward', async () => {
    const events: string[] = [];
    const manager = new TabManager(
      async () => {
        events.push('activate');
      },
      undefined,
      undefined,
      {
        onDocumentPrepared: async () => {
          events.push('prepare');
        },
        onDocumentOpened: async () => {
          events.push('opened');
        },
      },
    );

    await manager.createTab('/tmp/one.pdf', 'one.pdf', new Uint8Array([1]));

    expect(events).toEqual(['prepare', 'activate', 'opened']);
  });

  it('routes a new Document explicit page through semantic activation', async () => {
    const requestActivation = vi.fn(async () => undefined);
    const manager = new TabManager(vi.fn());
    manager.setActivationRequester(requestActivation);
    vi.spyOn(PDFViewer.prototype, 'goToPage').mockResolvedValueOnce();
    vi.spyOn(PDFViewer.prototype, 'getReadingPosition').mockReturnValueOnce({
      page: 7,
      location: 0,
    });

    await manager.createTab(
      '/tmp/report.pdf',
      'report.pdf',
      new Uint8Array([1]),
      undefined,
      'single',
      { initialPage: 7 },
    );

    expect(requestActivation).toHaveBeenCalledWith('/tmp/report.pdf', {
      page: 7,
      location: 0,
    });
  });

  it('does not turn a successful reactivation into failure when an observer throws', async () => {
    const onDocumentOpened = vi.fn(async () => {
      throw new Error('history unavailable');
    });
    const manager = new TabManager(vi.fn(), undefined, undefined, { onDocumentOpened });
    const tab = await manager.createTab('/tmp/one.pdf', 'one.pdf', new Uint8Array([1]));

    await expect(manager.reactivateOpenDocument(tab.id)).resolves.toBeUndefined();

    expect(manager.getActiveTab()?.filePath).toBe('/tmp/one.pdf');
    expect(onDocumentOpened).toHaveBeenCalledTimes(2);
  });

  it('can restore a Document quietly without explicit-open observer semantics', async () => {
    const onDocumentOpened = vi.fn(async () => undefined);
    const onTabChange = vi.fn(async () => undefined);
    const manager = new TabManager(onTabChange, undefined, undefined, { onDocumentOpened });
    const goToReadingPosition = vi.spyOn(PDFViewer.prototype, 'goToReadingPosition');

    const tab = await manager.createTab(
      '/tmp/restored.pdf',
      'restored.pdf',
      new Uint8Array([1]),
      undefined,
      'single',
      {
        activate: false,
        notifyOpened: false,
        restoredDocument: restoredDocument('/tmp/restored.pdf'),
      },
    );

    await expect(
      manager.reactivateOpenDocument(tab.id, { notifyOpened: false }),
    ).resolves.toBeUndefined();

    expect(onDocumentOpened).not.toHaveBeenCalled();
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(tab.currentPage).toBe(4);
    expect(tab.viewMode).toBe('continuous');
    expect(goToReadingPosition).toHaveBeenCalledWith({ page: 4, location: 0.6 });
  });

  it('notifies an explicit open without activating an existing Document', async () => {
    const onDocumentOpened = vi.fn(async () => undefined);
    const manager = new TabManager(vi.fn(), undefined, undefined, { onDocumentOpened });
    const active = await manager.createTab(
      '/tmp/active.pdf',
      'active.pdf',
      new Uint8Array([1]),
      undefined,
      'single',
      { notifyOpened: false },
    );
    await manager.createTab(
      '/tmp/background.pdf',
      'background.pdf',
      new Uint8Array([2]),
      undefined,
      'single',
      { activate: false, notifyOpened: false },
    );

    await manager.notifyDocumentOpened('/tmp/background.pdf');

    expect(manager.getActiveTab()?.id).toBe(active.id);
    expect(onDocumentOpened).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/tmp/background.pdf' }),
    );
  });

  it('restores saved Visual State on an existing Document while preserving an explicit page', async () => {
    const manager = new TabManager(vi.fn());
    const tab = await manager.createTab('/tmp/report.pdf', 'report.pdf', new Uint8Array([1]));
    vi.spyOn(PDFViewer.prototype, 'getReadingPosition').mockReturnValueOnce({
      page: 9,
      location: 0,
    });

    const restored = await manager.restoreExistingDocument(
      '/tmp/report.pdf',
      restoredDocument('/tmp/report.pdf'),
      { preserveReadingPosition: true },
    );

    expect(restored.readingPosition).toEqual({ page: 9, location: 0 });
    expect(tab.currentPage).toBe(9);
    expect(tab.viewMode).toBe('continuous');
    expect(tab.rotation).toBe(90);
  });

  it('rolls back an existing Document when saved-state projection fails', async () => {
    const manager = new TabManager(vi.fn());
    const tab = await manager.createTab('/tmp/report.pdf', 'report.pdf', new Uint8Array([1]));
    const previous = {
      currentPage: tab.currentPage,
      viewMode: tab.viewMode,
      rotation: tab.rotation,
      zoomIntent: tab.zoomIntent,
      filterSettings: tab.filterSettings,
    };
    vi.spyOn(PDFViewer.prototype, 'setRotation').mockRejectedValueOnce(
      new Error('rotation projection failed'),
    );

    await expect(
      manager.restoreExistingDocument('/tmp/report.pdf', restoredDocument('/tmp/report.pdf'), {
        preserveReadingPosition: false,
      }),
    ).rejects.toThrow('rotation projection failed');

    expect(tab).toMatchObject(previous);
  });

  it('rolls back restored projection before Reading Session registration', async () => {
    vi.spyOn(PDFViewer.prototype, 'setRotation').mockRejectedValueOnce(
      new Error('rotation projection failed'),
    );
    const onDocumentPrepared = vi.fn(async () => undefined);
    const manager = new TabManager(vi.fn(), undefined, undefined, { onDocumentPrepared });

    await expect(
      manager.createTab(
        '/tmp/restored.pdf',
        'restored.pdf',
        new Uint8Array([1]),
        undefined,
        'single',
        {
          activate: false,
          notifyOpened: false,
          restoredDocument: restoredDocument('/tmp/restored.pdf'),
        },
      ),
    ).rejects.toThrow('rotation projection failed');

    expect(manager.size).toBe(0);
    expect(onDocumentPrepared).not.toHaveBeenCalled();
  });

  it('routes explicit Document pages through the semantic navigation adapter', async () => {
    const onDocumentPageRequested = vi.fn(async () => undefined);
    const manager = new TabManager(vi.fn(), undefined, undefined, {
      onDocumentPageRequested,
    });
    await manager.createTab('/tmp/one.pdf', 'one.pdf', new Uint8Array([1]));

    await manager.requestDocumentPage('/tmp/one.pdf', 9);

    expect(onDocumentPageRequested).toHaveBeenCalledWith('/tmp/one.pdf', 9);
  });

  it('closes to the right neighbor when available and otherwise to the left', async () => {
    const manager = new TabManager(vi.fn());
    const first = await manager.createTab('/tmp/one.pdf', 'one.pdf', new Uint8Array([1]));
    const second = await manager.createTab('/tmp/two.pdf', 'two.pdf', new Uint8Array([2]));
    const third = await manager.createTab('/tmp/three.pdf', 'three.pdf', new Uint8Array([3]));

    await manager.activateTab(second.id);
    await manager.projectDocumentClose(second.filePath, third.filePath);
    expect(manager.getActiveTab()?.filePath).toBe('/tmp/three.pdf');

    await manager.projectDocumentClose(third.filePath, first.filePath);
    expect(manager.getActiveTab()?.filePath).toBe(first.filePath);
  });

  it('routes close requests through Reader Actions before projecting the selected neighbor', async () => {
    const onDocumentCloseRequested = vi.fn(async () => undefined);
    const manager = new TabManager(vi.fn(), undefined, undefined, {
      onDocumentCloseRequested,
    });
    const first = await manager.createTab('/tmp/one.pdf', 'one.pdf', new Uint8Array([1]));
    const second = await manager.createTab('/tmp/two.pdf', 'two.pdf', new Uint8Array([2]));

    await manager.activateTab(first.id);
    const destroy = vi.spyOn(manager.getViewerForTab(first.id) as PDFViewer, 'destroy');
    await manager.closeTab(first.id);

    expect(onDocumentCloseRequested).toHaveBeenCalledWith('/tmp/one.pdf');
    expect(manager.size).toBe(2);
    expect(destroy).not.toHaveBeenCalled();

    await manager.projectDocumentClose('/tmp/one.pdf', '/tmp/two.pdf');

    expect(destroy).toHaveBeenCalledOnce();
    expect(manager.getTabs().map((tab) => tab.filePath)).toEqual(['/tmp/two.pdf']);
    expect(manager.getActiveTab()?.filePath).toBe(second.filePath);
  });

  it('projects the authoritative Reading Session order into the tab strip', async () => {
    const manager = new TabManager(vi.fn());
    await manager.createTab('/tmp/one.pdf', 'one.pdf', new Uint8Array([1]));
    await manager.createTab('/tmp/two.pdf', 'two.pdf', new Uint8Array([2]));
    await manager.createTab('/tmp/three.pdf', 'three.pdf', new Uint8Array([3]));

    manager.setDocumentOrder(['/tmp/three.pdf', '/tmp/one.pdf', '/tmp/two.pdf']);

    expect(manager.getTabs().map((tab) => tab.filePath)).toEqual([
      '/tmp/three.pdf',
      '/tmp/one.pdf',
      '/tmp/two.pdf',
    ]);
  });

  it('rolls back an unregistered runtime without closing an authoritative Document', async () => {
    const onDocumentClosed = vi.fn(async () => undefined);
    const manager = new TabManager(vi.fn(), undefined, undefined, {
      onDocumentPrepared: async () => {
        throw new Error('session commit failed');
      },
      onDocumentClosed,
    });

    await expect(
      manager.createTab('/tmp/failing.pdf', 'failing.pdf', new Uint8Array([1])),
    ).rejects.toThrow('session commit failed');

    expect(manager.size).toBe(0);
    expect(onDocumentClosed).not.toHaveBeenCalled();
  });

  it('removes a registered Document when activation fails', async () => {
    const onDocumentClosed = vi.fn(async () => undefined);
    const manager = new TabManager(
      async () => {
        throw new Error('activation failed');
      },
      undefined,
      undefined,
      {
        onDocumentPrepared: vi.fn(async () => undefined),
        onDocumentClosed,
      },
    );

    await expect(
      manager.createTab('/tmp/failing.pdf', 'failing.pdf', new Uint8Array([1])),
    ).rejects.toThrow('activation failed');

    expect(manager.size).toBe(0);
    expect(onDocumentClosed).toHaveBeenCalledWith('/tmp/failing.pdf');
  });

  it('restores the active Document when a new Document activation rolls back', async () => {
    const manager = new TabManager(
      async (tab) => {
        if (tab?.filePath === '/tmp/failing.pdf') throw new Error('activation failed');
      },
      undefined,
      undefined,
      {
        onDocumentPrepared: vi.fn(async () => undefined),
        onDocumentClosed: vi.fn(async () => undefined),
      },
    );
    const existing = await manager.createTab(
      '/tmp/existing.pdf',
      'existing.pdf',
      new Uint8Array([1]),
    );

    await expect(
      manager.createTab('/tmp/failing.pdf', 'failing.pdf', new Uint8Array([2])),
    ).rejects.toThrow('activation failed');

    const existingSurface = document.getElementById(`pdf-canvas-${existing.id}`)?.parentElement;
    expect(manager.getTabs().map((tab) => tab.filePath)).toEqual(['/tmp/existing.pdf']);
    expect(manager.getActiveTab()?.filePath).toBe('/tmp/existing.pdf');
    expect(existingSurface?.style.display).toBe('block');
  });

  it('rolls back before registration when the explicit initial page fails to render', async () => {
    vi.spyOn(PDFViewer.prototype, 'goToPage').mockRejectedValueOnce(
      new Error('page render failed'),
    );
    const onDocumentPrepared = vi.fn(async () => undefined);
    const manager = new TabManager(vi.fn(), undefined, undefined, { onDocumentPrepared });

    await expect(
      manager.createTab(
        '/tmp/failing.pdf',
        'failing.pdf',
        new Uint8Array([1]),
        undefined,
        'single',
        { initialPage: 12 },
      ),
    ).rejects.toThrow('page render failed');

    expect(manager.size).toBe(0);
    expect(onDocumentPrepared).not.toHaveBeenCalled();
  });

  it('observes normalized Reading Position at most once per animation frame', async () => {
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    vi.spyOn(PDFViewer.prototype, 'getReadingPosition').mockReturnValue({
      page: 1,
      location: 0.375,
    });
    const onReadingPositionObserved = vi.fn();
    const manager = new TabManager(vi.fn(), undefined, undefined, {
      onReadingPositionObserved,
    });
    await manager.createTab('/tmp/one.pdf', 'one.pdf', new Uint8Array([1]));
    const container = document.getElementById('pdf-container');

    container?.dispatchEvent(new Event('scroll'));
    container?.dispatchEvent(new Event('scroll'));
    expect(onReadingPositionObserved).not.toHaveBeenCalled();

    frame?.(0);

    expect(onReadingPositionObserved).toHaveBeenCalledOnce();
    expect(onReadingPositionObserved).toHaveBeenCalledWith('/tmp/one.pdf', {
      page: 1,
      location: 0.375,
    });
  });
});
