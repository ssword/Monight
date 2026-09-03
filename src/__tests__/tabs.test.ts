// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPdfEngine = vi.hoisted(() => vi.fn());

vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

import { PDFViewer } from '../scripts/pdf-viewer';
import { TabManager } from '../scripts/tabs';

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

  it('closes to the right neighbor when available and otherwise to the left', async () => {
    const manager = new TabManager(vi.fn());
    const first = await manager.createTab('/tmp/one.pdf', 'one.pdf', new Uint8Array([1]));
    const second = await manager.createTab('/tmp/two.pdf', 'two.pdf', new Uint8Array([2]));
    const third = await manager.createTab('/tmp/three.pdf', 'three.pdf', new Uint8Array([3]));

    await manager.activateTab(second.id);
    await manager.closeTab(second.id);
    expect(manager.getActiveTab()?.filePath).toBe('/tmp/three.pdf');

    await manager.closeTab(third.id);
    expect(manager.getActiveTab()?.filePath).toBe(first.filePath);
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
