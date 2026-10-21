// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hydrateChromeIcons } from '../app/chrome-icons';

const projectFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const loadAppShell = () => {
  const html = projectFile('index.html');
  document.body.innerHTML = html
    .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '');
  return html;
};

describe('reader chrome assets', () => {
  it('renders every toolbar icon from the bundled outline set', () => {
    loadAppShell();
    const toolbar = document.getElementById('toolbar');
    const iconSlots = Array.from(document.querySelectorAll<HTMLElement>('[data-icon]'));
    expect(iconSlots.length).toBeGreaterThanOrEqual(4);

    hydrateChromeIcons(document);

    for (const slot of iconSlots) {
      const svg = slot.querySelector('svg');
      expect(svg, slot.dataset.icon).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.querySelector('*'), slot.dataset.icon).not.toBeNull();
    }
    // Emoji glyphs are gone from the chrome.
    expect(toolbar?.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('refuses an icon name that is not bundled', () => {
    document.body.innerHTML = '<span data-icon="not-an-icon"></span>';
    expect(() => hydrateChromeIcons(document)).toThrow(/not-an-icon/);
  });

  it('follows the OS appearance with chrome tokens drawn from the brand palette', () => {
    const css = projectFile('src/styles/main.css');
    const brandPalette = new Set(
      ['#0c182c', '#16263d', '#25415f', '#8faecf', '#fbfdff', '#ffd48c', '#fff2ce'].map((hex) =>
        hex.toLowerCase(),
      ),
    );
    const tokensIn = (block: string) =>
      Object.fromEntries(
        Array.from(block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), ([, name, value]) => [
          name,
          value.trim().toLowerCase(),
        ]),
      );
    const light = css.match(
      /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\s*\{([^}]*)\}/,
    );
    expect(light, 'a light-appearance token set').not.toBeNull();
    const lightTokens = tokensIn(light?.[1] ?? '');
    const chromeTokens = [
      '--bg-primary',
      '--bg-secondary',
      '--bg-elevated',
      '--text-primary',
      '--text-secondary',
      '--border-color',
      '--accent-color',
    ];
    for (const token of chromeTokens) expect(lightTokens, token).toHaveProperty(token);
    // Surfaces and ink come from the brand palette (directly, via a brand token, or a mix of them).
    for (const token of ['--bg-secondary', '--text-primary', '--accent-color']) {
      const value = lightTokens[token] ?? '';
      expect(value.includes('var(--brand-') || brandPalette.has(value), `${token}: ${value}`).toBe(
        true,
      );
    }
    expect(css).toMatch(/color-scheme:\s*light dark/);

    // The window theme is not pinned, so the WebView reports the OS appearance.
    const tauri = JSON.parse(projectFile('src-tauri/tauri.conf.json')) as {
      app: { windows: { theme?: string }[] };
    };
    for (const window of tauri.app.windows) expect(window.theme).toBeUndefined();
  });

  it('never applies a reading filter to the chrome', () => {
    for (const stylesheet of [
      'main.css',
      'reader-shell.css',
      'tabs.css',
      'document-workspace.css',
    ]) {
      const css = projectFile(`src/styles/${stylesheet}`);
      expect(css, stylesheet).not.toMatch(/(?<![-\w])filter\s*:/);
    }
  });

  it('never references a network asset from the app shell', () => {
    const html = loadAppShell();
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
    for (const stylesheet of ['main.css', 'reader-shell.css', 'configurator.css', 'tabs.css']) {
      const css = projectFile(`src/styles/${stylesheet}`);
      expect(css, stylesheet).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i);
      expect(css, stylesheet).not.toMatch(/@import\s+(?:url\()?["']?(?:https?:)?\/\//i);
    }
  });
});
