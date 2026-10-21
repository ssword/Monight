// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import type { ActiveMarkupState } from '../app/document-workspace';
import { createRotateButton } from '../app/rotate-button';

describe('toolbar Rotate button', () => {
  let markup: ActiveMarkupState | null;
  let commands: string[];

  const slot = () => document.getElementById('rotate-control') as HTMLElement;
  const button = () => slot().querySelector('button');
  const mount = (verified: boolean) =>
    createRotateButton({
      slot: slot(),
      verified,
      isMac: true,
      activeMarkup: () => markup,
      runCommand: async (id) => {
        commands.push(id);
        return true;
      },
    });

  beforeEach(() => {
    document.body.innerHTML = '<div id="rotate-control" class="toolbar-capsule" hidden></div>';
    markup = { activeToolId: null, readOnlyReason: null };
    commands = [];
  });

  it('is absent while Page Rotation is unverified', () => {
    mount(false);
    expect(slot().hidden).toBe(true);
    expect(slot().children).toHaveLength(0);
  });

  it('rotates left on click and right on Option-click, as Preview does', () => {
    mount(true);
    expect(slot().hidden).toBe(false);
    expect(button()?.getAttribute('aria-label')).toBe('Rotate Left');

    button()?.click();
    button()?.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));

    expect(commands).toEqual(['tools.rotate.left', 'tools.rotate.right']);
  });

  it('is unavailable on protected Documents with their explanation', () => {
    markup = { activeToolId: null, readOnlyReason: 'This Document is signed' };
    const rotate = mount(true);

    expect(button()?.disabled).toBe(true);
    expect(button()?.title).toBe('This Document is signed');
    button()?.click();
    expect(commands).toEqual([]);

    markup = { activeToolId: null, readOnlyReason: null };
    rotate?.refresh();
    expect(button()?.disabled).toBe(false);
    expect(button()?.title).toBe('Rotate Left (Option-click to Rotate Right)');
  });

  it('is unavailable without a Document', () => {
    markup = null;
    mount(true);
    expect(button()?.disabled).toBe(true);
  });
});

describe('the shipped Page Rotation gate', () => {
  it('alone decides whether every Rotate control exists', async () => {
    const { PAGE_ROTATION_VERIFIED } = await import('../lib/verification-gates');
    const { readerCommandStates, readerMenuSubmenus } = await import('../app/reader-commands');
    const { DEFAULT_CHROME_PREFERENCES } = await import('../app/chrome-preferences');
    const { defaultSettings } = await import('../scripts/settings');
    document.body.innerHTML = '<div id="rotate-control" hidden></div>';
    const slot = document.getElementById('rotate-control') as HTMLElement;

    createRotateButton({ slot, activeMarkup: () => null, runCommand: async () => true });
    const keybinds = defaultSettings('mac').keybinds;
    const states = readerCommandStates({
      documentCount: 0,
      activeDocument: null,
      preferences: DEFAULT_CHROME_PREFERENCES,
      markup: null,
      fullScreen: false,
      canGoBack: false,
      canGoForward: false,
      tabBarKeptShown: false,
      textFieldFocused: false,
      keybinds,
    });

    expect(slot.querySelector('button') !== null).toBe(PAGE_ROTATION_VERIFIED);
    expect('RotateLeft' in keybinds && 'RotateRight' in keybinds).toBe(PAGE_ROTATION_VERIFIED);
    expect(states.some(({ id }) => id.startsWith('tools.rotate.'))).toBe(PAGE_ROTATION_VERIFIED);
    expect(readerMenuSubmenus().find(({ id }) => id === 'tools.rotate')?.items.length === 2).toBe(
      PAGE_ROTATION_VERIFIED,
    );
  });
});
