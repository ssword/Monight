// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPdfEngine = vi.hoisted(() => vi.fn());

vi.mock('../lib/pdf-engine', () => ({ getPdfEngine }));

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
});
