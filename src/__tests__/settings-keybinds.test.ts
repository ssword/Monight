// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { emit } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import { keybindDefaultsVersion } from '../scripts/keybind-defaults';
import { type MoonightSettings, SETTINGS_SCHEMA_VERSION } from '../scripts/settings';

vi.mock('@tauri-apps/api/app', () => ({
  getName: async () => 'Monight',
  getVersion: async () => '0.6.0',
  getTauriVersion: async () => '2',
}));
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => {}),
}));
const storeSet = vi.hoisted(() => vi.fn(async (_key: string, _value: unknown) => {}));

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: async () => ({
      get: async (key: string) => {
        if (key === 'storageSchemaVersion') return SETTINGS_SCHEMA_VERSION;
        if (key === 'keybindDefaultsVersion') return keybindDefaultsVersion();
      },
      set: storeSet,
      save: async () => {},
    }),
  },
}));

function shortcutRow(name: string): HTMLElement {
  const row = Array.from(document.querySelectorAll<HTMLElement>('.keybind-item')).find(
    (item) => item.querySelector('.keybind-name')?.textContent === name,
  );
  if (!row) throw new Error(`Missing shortcut row: ${name}`);
  return row;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it.each([
  { platform: 'MacIntel', modifier: 'Cmd', keyEvent: { metaKey: true }, button: '.btn' },
  { platform: 'Win32', modifier: 'Ctrl', keyEvent: { ctrlKey: true }, button: '.keybind-add' },
])('asks before reassigning the Open PDF shortcut on $platform', async (scenario) => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { platform: scenario.platform });
  vi.useFakeTimers();
  const html = readFileSync('settings.html', 'utf8');
  const page = new DOMParser().parseFromString(html, 'text/html');
  page.querySelector('script')?.remove();
  document.body.innerHTML = page.body.innerHTML;
  await import('../scripts/settings-page');

  const shortcut = `${scenario.modifier} + O`;
  await vi.waitFor(() => expect(shortcutRow('Open PDF').textContent).toContain(shortcut));
  document.querySelector<HTMLElement>('[data-panel="keybinds"]')?.click();

  const dialog = document.querySelector<HTMLDialogElement>('#confirmation-dialog');
  if (!dialog) throw new Error('Missing confirmation dialog');

  const captureOpenPdfShortcut = async () => {
    shortcutRow('Find in Document').querySelector<HTMLElement>(scenario.button)?.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ...scenario.keyEvent }));
    await vi.advanceTimersByTimeAsync(300);
  };

  await captureOpenPdfShortcut();
  expect({
    duplicateShown: shortcutRow('Find in Document').textContent?.includes(shortcut),
    warning: dialog.open ? dialog.querySelector('[data-confirmation-message]')?.textContent : null,
  }).toEqual({
    duplicateShown: false,
    warning: expect.stringContaining('Open PDF'),
  });
  expect(storeSet).not.toHaveBeenCalled();

  dialog.querySelector<HTMLElement>('[data-dialog-cancel]')?.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(shortcutRow('Open PDF').textContent).toContain(shortcut);
  expect(shortcutRow('Find in Document').textContent).not.toContain(shortcut);
  expect(storeSet).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalledWith('keybinds-changed');

  await captureOpenPdfShortcut();
  dialog.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.advanceTimersByTimeAsync(0);

  const saved = storeSet.mock.calls[0]?.[1] as MoonightSettings['keybinds'] | undefined;
  expect(storeSet).toHaveBeenCalledTimes(1);
  expect(saved?.OpenFile.binds).toEqual([]);
  expect(saved?.Find.binds).toEqual([
    ...(scenario.button === '.keybind-add' ? ['CmdOrCtrl+F'] : []),
    `${scenario.modifier}+O`,
  ]);
  expect(shortcutRow('Open PDF').textContent).not.toContain(shortcut);
  expect(shortcutRow('Find in Document').textContent).toContain(shortcut);
  expect(emit).toHaveBeenCalledWith('keybinds-changed');
});
