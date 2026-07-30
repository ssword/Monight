import { describe, expect, it, vi } from 'vitest';
import { KeybindManager } from '../scripts/keybind-manager';
import { DEFAULT_SETTINGS } from '../scripts/settings';

function keyboardEvent(
  key: string,
  {
    metaKey = true,
    shiftKey = false,
    target = null,
  }: {
    metaKey?: boolean;
    shiftKey?: boolean;
    target?: EventTarget | null;
  } = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey,
    shiftKey,
    altKey: false,
    target,
  } as KeyboardEvent;
}

describe('KeybindManager', () => {
  it('keeps every configured tab shortcut and routes its own tab position', async () => {
    const manager = new KeybindManager(true);
    const switchToTab = vi.fn();
    manager.registerAction('switchToTab', switchToTab);
    manager.loadFromSettings(DEFAULT_SETTINGS);

    const configuredTabBindings = Array.from(manager.getAllKeybinds().keys()).filter((actionId) =>
      actionId.startsWith('SwitchToTab'),
    );
    expect(configuredTabBindings).toHaveLength(9);

    const firstEvent = keyboardEvent('1');
    const eighthEvent = keyboardEvent('8');
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
});
