import { readFileSync } from 'node:fs';
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
    ];

    expect(tauriConfig.version).toBe('../package.json');
    for (const source of duplicatedRuntimeSources) {
      expect(source).not.toContain(npmManifest.version);
    }
  });
});
