import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('shipped code-health invariants', () => {
  it('takes the app version only from the npm manifest', () => {
    const npmManifest = JSON.parse(readProjectFile('package.json')) as { version: string };
    const tauriConfig = JSON.parse(readProjectFile('src-tauri/tauri.conf.json')) as {
      version: string;
    };
    const duplicatedRuntimeSources = [
      readProjectFile('src/main.ts'),
      readProjectFile('settings.html'),
      readProjectFile('README.md'),
      readProjectFile('src-tauri/Cargo.toml'),
    ];

    expect(tauriConfig.version).toBe('../package.json');
    for (const source of duplicatedRuntimeSources) {
      expect(source).not.toContain(npmManifest.version);
    }
  });

  it('ships no legacy tab authority or direct concrete-viewer lookup surface', () => {
    const removedModules = [
      'src/scripts/tabs.ts',
      'src/scripts/tab-reading-session.ts',
      'src/app/tab-state.ts',
      'src/app/session-state.ts',
      'src/app/viewer-helpers.ts',
    ];
    for (const path of removedModules) {
      expect(existsSync(new URL(`../../${path}`, import.meta.url))).toBe(false);
    }

    const shippedAdapters = [
      'src/main.ts',
      'src/application.ts',
      'src/app/dom-events.ts',
      'src/app/file-actions.ts',
      'src/app/keybinds.ts',
      'src/app/tauri-events.ts',
      'src/app/ui.ts',
    ].map(readProjectFile);
    for (const source of shippedAdapters) {
      expect(source).not.toMatch(/TabManager|TabData|getRenderingForTab/);
    }

    const readerFacingAdapters = [
      'src/app/dom-events.ts',
      'src/app/file-actions.ts',
      'src/app/keybinds.ts',
      'src/app/presentation-controller.ts',
      'src/app/search-controller.ts',
      'src/app/sidebar-controller.ts',
      'src/app/tauri-events.ts',
      'src/app/window-lifecycle.ts',
      'src/reader/document-access.ts',
    ].map(readProjectFile);
    for (const source of readerFacingAdapters) {
      expect(source).not.toMatch(/\.rendering\b|getActiveViewer|getRenderingForTab/);
    }

    const entryPoint = readProjectFile('src/main.ts');
    expect(entryPoint).toContain('initializeApplication');
    expect(entryPoint).not.toMatch(
      /restoreStartupReadingSession|flushPersistentAuthorities|getActiveRendering|dispatchReaderAction/,
    );
  });
});
