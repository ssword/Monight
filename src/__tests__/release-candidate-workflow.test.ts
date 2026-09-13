import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => new URL(`../../${path}`, import.meta.url);

const readProjectFile = (path: string): string => readFileSync(projectPath(path), 'utf8');

describe('release-candidate packaging workflow', () => {
  it('packages every desktop platform from a manual, read-only workflow', () => {
    const workflowPath = projectPath('.github/workflows/release-candidate.yml');

    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readProjectFile('.github/workflows/release-candidate.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+(push|pull_request|release|schedule):/m);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(workflow).toContain('uses: ./.github/actions/setup-node');
    expect(workflow).toContain('uses: ./.github/actions/setup-rust');
    expect(workflow).toContain('macos-latest');
    expect(workflow).toContain('windows-latest');
    expect(workflow).toContain('ubuntu-latest');
    expect(workflow).toContain('--bundles app,dmg --target universal-apple-darwin');
    expect(workflow).toContain('--bundles nsis,msi');
    expect(workflow).toContain('--bundles deb,rpm,appimage');
    expect(workflow).toContain('APPLE_SIGNING_IDENTITY: "-"');
    expect(workflow).toContain('node scripts/prepare-release-candidate.mjs');
    expect(workflow).toContain(
      ['name: $', '{{ matrix.platform }}-$', '{{ steps.metadata.outputs.short_sha }}'].join(''),
    );
    expect(workflow).toContain('retention-days: 14');
  });

  it('keeps CI and candidate builds on shared toolchain setup', () => {
    const workflow = readProjectFile('.github/workflows/ci.yml');

    expect(workflow).toContain('uses: ./.github/actions/setup-node');
    expect(workflow).toContain('uses: ./.github/actions/setup-rust');
    expect(existsSync(projectPath('.github/actions/setup-node/action.yml'))).toBe(true);
    expect(existsSync(projectPath('.github/actions/setup-rust/action.yml'))).toBe(true);
  });
});
