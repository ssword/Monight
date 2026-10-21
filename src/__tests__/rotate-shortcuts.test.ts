// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupEventListeners } from '../app/dom-events';
import { KeybindManager } from '../scripts/keybind-manager';
import { defaultSettings } from '../scripts/settings';

describe('Rotate shortcuts on Windows and Linux', () => {
  const listeners: EventListenerOrEventListenerObject[] = [];

  afterEach(() => {
    for (const listener of listeners.splice(0))
      document.removeEventListener('keydown', listener, true);
    vi.restoreAllMocks();
  });

  const mountWith = (pageRotationVerified: boolean) => {
    const addEventListener = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'keydown' && listener) listeners.push(listener);
      addEventListener(type, listener, options);
    });
    const keybindManager = new KeybindManager(false);
    keybindManager.loadFromSettings(
      defaultSettings('other', { pageRotation: pageRotationVerified }),
    );
    const commands: string[] = [];
    keybindManager.registerAction('readerCommand', (_event, id) => {
      if (id) commands.push(id);
    });
    setupEventListeners({
      sliderManager: null,
      keybindManager,
      openPdfAndRefresh: vi.fn(async () => undefined),
      activateDocument: vi.fn(async () => undefined),
      openRecentFile: vi.fn(async () => undefined),
      clearRecentFiles: vi.fn(async () => undefined),
      dispatchReaderAction: vi.fn(async () => undefined),
    });
    return commands;
  };
  const press = (target: EventTarget, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it('Ctrl+L and Ctrl+R rotate instead of reaching the WebView', async () => {
    document.body.innerHTML = '';
    const commands = mountWith(true);

    const right = press(document.body, { key: 'r', code: 'KeyR', ctrlKey: true });
    const left = press(document.body, { key: 'l', code: 'KeyL', ctrlKey: true });
    await Promise.resolve();

    expect(commands).toEqual(['tools.rotate.right', 'tools.rotate.left']);
    expect(right.defaultPrevented).toBe(true);
    expect(left.defaultPrevented).toBe(true);
  });

  it('reach nothing while Page Rotation is unverified', async () => {
    document.body.innerHTML = '';
    const commands = mountWith(false);

    press(document.body, { key: 'r', code: 'KeyR', ctrlKey: true });
    press(document.body, { key: 'l', code: 'KeyL', ctrlKey: true });
    await Promise.resolve();

    expect(commands).toEqual([]);
  });

  it('never let a reload chord reload the reader, even unbound or in a text field', async () => {
    document.body.innerHTML = '<input id="search" />';
    const commands = mountWith(false);
    const field = document.getElementById('search') as HTMLInputElement;

    const unbound = press(document.body, { key: 'r', code: 'KeyR', ctrlKey: true });
    const inField = press(field, { key: 'r', code: 'KeyR', ctrlKey: true });
    const hard = press(document.body, { key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true });
    const f5 = press(document.body, { key: 'F5', code: 'F5' });
    const typing = press(field, { key: 'r', code: 'KeyR' });
    await Promise.resolve();

    expect(commands).toEqual([]);
    expect([unbound, inField, hard, f5].map((event) => event.defaultPrevented)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(typing.defaultPrevented).toBe(false);
  });
});
