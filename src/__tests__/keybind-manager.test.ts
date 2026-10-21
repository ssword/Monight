import { describe, expect, it, vi } from 'vitest';
import { KeybindManager } from '../scripts/keybind-manager';
import { DEFAULT_SETTINGS, defaultSettings, type MoonightSettings } from '../scripts/settings';

function keyboardEvent(
  key: string,
  {
    code = '',
    metaKey = true,
    ctrlKey = false,
    shiftKey = false,
    altKey = false,
    target = null,
  }: {
    code?: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    target?: EventTarget | null;
  } = {},
): KeyboardEvent {
  return { key, code, ctrlKey, metaKey, shiftKey, altKey, target } as KeyboardEvent;
}

const withTabShortcuts = (settings: MoonightSettings): MoonightSettings => {
  const configured = structuredClone(settings);
  configured.keybinds.SwitchToTab1.binds = ['CmdOrCtrl+Alt+Shift+1'];
  configured.keybinds.SwitchToTab8.binds = ['CmdOrCtrl+Alt+Shift+8'];
  return configured;
};

describe('KeybindManager', () => {
  it('binds Switch to Tab N only when the reader configures it, routing its own position', async () => {
    const manager = new KeybindManager(true);
    const switchToTab = vi.fn();
    manager.registerAction('switchToTab', switchToTab);
    manager.loadFromSettings(defaultSettings('mac'));
    expect(
      Array.from(manager.getAllKeybinds().keys()).filter((id) => id.startsWith('SwitchToTab')),
    ).toEqual([]);

    manager.loadFromSettings(withTabShortcuts(defaultSettings('mac')));
    // macOS reports the character Option and Shift produce, not the digit.
    const firstEvent = keyboardEvent('⁄', { code: 'Digit1', altKey: true, shiftKey: true });
    const eighthEvent = keyboardEvent('°', { code: 'Digit8', altKey: true, shiftKey: true });
    expect(manager.matchEvent(firstEvent)).toBe('switchToTab');
    expect(manager.matchEvent(eighthEvent)).toBe('switchToTab');

    await manager.handleEvent(firstEvent);
    await manager.handleEvent(eighthEvent);

    expect(switchToTab).toHaveBeenNthCalledWith(1, firstEvent, '1');
    expect(switchToTab).toHaveBeenNthCalledWith(2, eighthEvent, '8');
  });

  it('does not match global shortcuts from editable controls', () => {
    const manager = new KeybindManager(true);
    manager.loadFromSettings(DEFAULT_SETTINGS);

    expect(
      manager.matchEvent(
        keyboardEvent('ArrowUp', {
          metaKey: false,
          target: { tagName: 'INPUT' } as unknown as EventTarget,
        }),
      ),
    ).toBeNull();
    expect(
      manager.matchEvent(
        keyboardEvent('Home', {
          metaKey: false,
          target: { tagName: 'TEXTAREA' } as unknown as EventTarget,
        }),
      ),
    ).toBeNull();
    expect(
      manager.matchEvent(
        keyboardEvent('End', {
          metaKey: false,
          target: { isContentEditable: true } as unknown as EventTarget,
        }),
      ),
    ).toBeNull();
  });

  it('matches Cmd+Shift+= as the configured Plus accelerator', () => {
    const manager = new KeybindManager(true);
    manager.loadFromSettings(DEFAULT_SETTINGS);

    expect(manager.matchEvent(keyboardEvent('+', { shiftKey: true }))).toBe('zoomIn');
  });

  it('matches Option and Shift chords by the physical key when macOS changes the character', () => {
    const manager = new KeybindManager(true);
    manager.loadFromSettings(defaultSettings('mac'));

    expect(manager.matchEvent(keyboardEvent('™', { code: 'Digit2', altKey: true }))).toBe(
      'readerCommand',
    );
    expect(manager.matchEvent(keyboardEvent('}', { code: 'BracketRight', shiftKey: true }))).toBe(
      'nextTab',
    );
    expect(manager.matchEvent(keyboardEvent('{', { code: 'BracketLeft', shiftKey: true }))).toBe(
      'previousTab',
    );
    expect(manager.matchEvent(keyboardEvent('©', { code: 'KeyG', altKey: true }))).toBe(
      'readerCommand',
    );
    // A typed character still wins over the physical key.
    expect(manager.matchEvent(keyboardEvent('2', { code: 'Digit2', altKey: true }))).toBe(
      'readerCommand',
    );
    expect(manager.matchEvent(keyboardEvent('™', { code: 'Digit2' }))).toBeNull();
  });

  it('routes reader-command shortcuts with their command id', async () => {
    const manager = new KeybindManager(true);
    const readerCommand = vi.fn();
    manager.registerAction('readerCommand', readerCommand);
    manager.loadFromSettings(defaultSettings('mac'));

    expect(manager.matchEvent(keyboardEvent('∞', { code: 'Digit5', altKey: true }))).toBeNull();
    await manager.handleEvent(keyboardEvent('2'));
    await manager.handleEvent(keyboardEvent('£', { code: 'Digit3', altKey: true }));
    await manager.handleEvent(keyboardEvent('a', { code: 'KeyA', shiftKey: true }));

    expect(readerCommand.mock.calls.map(([, id]) => id)).toEqual([
      'view.mode.single',
      'view.sidebar.tableOfContents',
      'view.markup-toolbar',
    ]);
  });

  it('switches tabs with Control-Tab on every platform', () => {
    const platforms: Array<[boolean, 'mac' | 'other']> = [
      [true, 'mac'],
      [false, 'other'],
    ];
    for (const [isMac, platform] of platforms) {
      const manager = new KeybindManager(isMac);
      manager.loadFromSettings(defaultSettings(platform));
      const tab = { metaKey: false, ctrlKey: true };
      expect(manager.matchEvent(keyboardEvent('Tab', tab))).toBe('nextTab');
      expect(manager.matchEvent(keyboardEvent('Tab', { ...tab, shiftKey: true }))).toBe(
        'previousTab',
      );
    }
  });
});
