// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { hydrateChromeIcons } from '../app/chrome-icons';
import { applyWindowChrome, renderRecentFiles, updateTabBarVisibility } from '../app/ui';

const projectFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const loadAppShell = () => {
  const html = projectFile('index.html');
  document.body.innerHTML = html
    .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '');
};

describe('document tab bar', () => {
  beforeEach(() => {
    loadAppShell();
    const tabs = document.getElementById('tab-container');
    if (tabs) {
      tabs.innerHTML = `
        <div class="tab-item"><button role="tab" data-file-path="/docs/b.pdf">b.pdf</button></div>
        <div class="tab-item"><button role="tab" data-file-path="/docs/a.pdf">a.pdf</button></div>
      `;
    }
  });

  const tabBarHidden = () => document.getElementById('tab-bar')?.classList.contains('hidden');
  const tabOrder = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[role="tab"]'),
      (tab) => tab.dataset.filePath,
    );

  it('is hidden with no Document or one Document and shown with two or more', () => {
    updateTabBarVisibility(0);
    expect(tabBarHidden()).toBe(true);
    updateTabBarVisibility(1);
    expect(tabBarHidden()).toBe(true);
    updateTabBarVisibility(2);
    expect(tabBarHidden()).toBe(false);
    updateTabBarVisibility(5);
    expect(tabBarHidden()).toBe(false);
    updateTabBarVisibility(1);
    expect(tabBarHidden()).toBe(true);
  });

  it('keeps the rendered tabs in Reading Session order while hidden and shown', () => {
    updateTabBarVisibility(1);
    expect(tabOrder()).toEqual(['/docs/b.pdf', '/docs/a.pdf']);
    updateTabBarVisibility(2);
    expect(tabOrder()).toEqual(['/docs/b.pdf', '/docs/a.pdf']);
  });
});

describe('launch splash', () => {
  const recent = [
    { filePath: '/docs/report.pdf', title: 'report.pdf', openedAt: 2 },
    { filePath: '/docs/thesis.pdf', title: 'thesis.pdf', openedAt: 1 },
  ];

  it('opens Documents from a button with a bundled outline icon', () => {
    loadAppShell();
    hydrateChromeIcons(document);
    const open = document.getElementById('splash-open-btn');
    expect(open?.querySelector('[data-icon] svg')).not.toBeNull();
    expect(document.getElementById('splash-container')?.textContent).not.toMatch(
      /\p{Extended_Pictographic}/u,
    );
  });

  it('lists Recent Documents with a document icon, title, and path', () => {
    loadAppShell();
    renderRecentFiles(recent);
    const entries = Array.from(document.querySelectorAll<HTMLElement>('.recent-file-button'));
    expect(entries.map((entry) => entry.dataset.filePath)).toEqual([
      '/docs/report.pdf',
      '/docs/thesis.pdf',
    ]);
    for (const entry of entries) {
      expect(entry.querySelector('[data-icon] svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(entry.querySelector('.recent-file-title')?.textContent).toMatch(/\.pdf$/);
      expect(entry.querySelector('.recent-file-path')?.textContent).toBe(entry.dataset.filePath);
    }
    expect(document.getElementById('recent-files-section')?.classList.contains('hidden')).toBe(
      false,
    );
  });

  it('draws every splash colour from the light/dark chrome tokens', () => {
    const splashSelector = /splash|recent-file|app-title|app-subtitle|app-version|hint-text/;
    for (const stylesheet of ['main.css', 'document-workspace.css']) {
      const css = projectFile(`src/styles/${stylesheet}`).replace(/\/\*[\s\S]*?\*\//g, '');
      const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).filter(([, selector]) =>
        splashSelector.test(selector),
      );
      expect(rules.length, stylesheet).toBeGreaterThan(0);
      for (const [, selector, body] of rules) {
        expect(body, `${stylesheet} ${selector.trim()}`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
      }
    }
  });
});

describe('Settings window palette', () => {
  const tokensIn = (block: string) =>
    Object.fromEntries(
      Array.from(block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), ([, name, value]) => [
        name,
        value.replace(/\s+/g, ' ').trim().toLowerCase(),
      ]),
    );
  const appearanceTokens = (css: string) => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const dark = stripped.match(/:root\s*\{([^}]*)\}/);
    const light = stripped.match(
      /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\s*\{([^}]*)\}/,
    );
    return { dark: tokensIn(dark?.[1] ?? ''), light: tokensIn(light?.[1] ?? '') };
  };

  it('follows the OS appearance with the same light and dark tokens as the reader', () => {
    const reader = appearanceTokens(projectFile('src/styles/main.css'));
    const settingsHtml = projectFile('settings.html');
    const settings = appearanceTokens(
      settingsHtml.slice(settingsHtml.indexOf('<style>'), settingsHtml.indexOf('</style>')),
    );
    const colourTokens = [
      '--bg-primary',
      '--bg-secondary',
      '--bg-elevated',
      '--text-primary',
      '--text-secondary',
      '--text-on-accent',
      '--border-color',
      '--accent-color',
      '--accent-color-soft',
      '--accent-color-hover',
      '--accent-glow',
      '--accent-ink',
      '--chrome-hover',
      '--chrome-pressed',
    ];
    for (const token of colourTokens) {
      expect(settings.dark[token], `dark ${token}`).toBe(reader.dark[token]);
      expect(settings.light[token], `light ${token}`).toBe(reader.light[token]);
    }
    expect(settingsHtml).toMatch(/color-scheme:\s*light dark/);
  });
});

type WindowConfig = Record<string, unknown> & { label: string };
const windowsIn = (path: string) =>
  (JSON.parse(projectFile(path)) as { app?: { windows?: WindowConfig[] } }).app?.windows ?? [];

describe('platform title bar', () => {
  const [baseMain] = windowsIn('src-tauri/tauri.conf.json');

  it('keeps a conventional decorated title bar on Windows and Linux', () => {
    expect(baseMain).toMatchObject({ label: 'main', decorations: true });
    expect(baseMain).not.toHaveProperty('titleBarStyle');
    expect(baseMain).not.toHaveProperty('hiddenTitle');
    expect(baseMain).not.toHaveProperty('trafficLightPosition');
  });

  it('overlays the title bar on macOS with the traffic lights inset in the toolbar', () => {
    // Platform config replaces the windows array, so the macOS entry repeats the base window.
    const [macMain] = windowsIn('src-tauri/tauri.macos.conf.json');
    expect(macMain).toEqual({
      ...baseMain,
      titleBarStyle: 'Overlay',
      hiddenTitle: true,
      trafficLightPosition: { x: 18, y: 20 },
    });
  });

  it('lets the toolbar drag the window while its controls stay clickable', () => {
    loadAppShell();
    expect(document.getElementById('toolbar')?.dataset.tauriDragRegion).toBe('deep');
    // Without a toolbar the splash still offers a title-bar strip to drag.
    expect(
      document.querySelector('#splash-container [data-tauri-drag-region]'),
      'splash drag strip',
    ).not.toBeNull();
    const capability = JSON.parse(projectFile('src-tauri/capabilities/default.json')) as {
      permissions: string[];
    };
    expect(capability.permissions).toContain('core:window:allow-start-dragging');
  });

  it('marks the overlay title bar on macOS and the native title bar elsewhere', () => {
    applyWindowChrome(document, true);
    expect(document.documentElement.dataset.windowChrome).toBe('overlay');
    applyWindowChrome(document, false);
    expect(document.documentElement.dataset.windowChrome).toBe('native');
  });

  it('reserves the traffic-light inset only under the macOS overlay title bar', () => {
    const css = projectFile('src/styles/reader-shell.css');
    expect(css).toMatch(
      /:root\[data-window-chrome="overlay"\]\s*#toolbar\s*\{[^}]*padding-left:[^;]*--traffic-light-inset/,
    );
  });
});
