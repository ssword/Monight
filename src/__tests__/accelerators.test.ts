import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent } from '../scripts/accelerators';

const event = (key: string, init: Partial<KeyboardEvent> = {}) =>
  ({
    key,
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  }) as KeyboardEvent;

describe('recording a shortcut', () => {
  it('records the key rather than the character Option or Shift types on macOS', () => {
    expect(acceleratorFromEvent(event('™', { code: 'Digit2', metaKey: true, altKey: true }))).toBe(
      'Cmd+Alt+2',
    );
    expect(
      acceleratorFromEvent(event('}', { code: 'BracketRight', metaKey: true, shiftKey: true })),
    ).toBe('Cmd+Shift+]');
  });

  it('records plain keys, letters and named keys as typed', () => {
    expect(acceleratorFromEvent(event('a', { code: 'KeyA', ctrlKey: true }))).toBe('Ctrl+A');
    expect(acceleratorFromEvent(event('Tab', { code: 'Tab', ctrlKey: true, shiftKey: true }))).toBe(
      'Ctrl+Shift+Tab',
    );
    expect(acceleratorFromEvent(event(' ', { code: 'Space' }))).toBe('Space');
    expect(acceleratorFromEvent(event('Shift', { code: 'ShiftLeft', shiftKey: true }))).toBe(
      'Shift',
    );
  });
});
