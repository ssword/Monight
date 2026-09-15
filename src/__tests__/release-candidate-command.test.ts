import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn((executable: string, args: string[]) => {
    if (executable === 'npm.cmd' && args.includes('tauri')) return 'tauri 2.11.2\r\n';
    if (executable === 'npm.cmd') return '11.19.0\r\n';
    if (executable === 'rustc') return 'rustc 1.98.1\r\n';
    if (executable === 'cargo') return 'cargo 1.98.1\r\n';
    throw new Error(`Unexpected command: ${executable}`);
  }),
  writeFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFileSync: mocks.execFileSync }));
vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => [
    { isDirectory: () => false, name: 'Monight_2.0.0_x64-setup.exe' },
    { isDirectory: () => false, name: 'Monight_2.0.0_x64_en-US.msi' },
  ]),
  readFileSync: vi.fn((path: string) =>
    path.endsWith('package.json') ? '{"version":"2.0.0"}' : 'bundle bytes',
  ),
  rmSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 12 })),
  writeFileSync: mocks.writeFileSync,
}));

const originalPlatform = process.platform;
const originalPlatformArg = process.argv[2];
const originalGithubSha = process.env.GITHUB_SHA;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  process.argv[2] = originalPlatformArg;
  process.env.GITHUB_SHA = originalGithubSha;
  vi.restoreAllMocks();
});

describe('release candidate Windows staging', () => {
  it('executes command shims through the shell and records their output', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.argv[2] = 'windows';
    process.env.GITHUB_SHA = 'fd76e86f64300de7a9ff06a0c9dfbc5d8cd12514';

    const stagingScript = '../../scripts/prepare-release-candidate.mjs';
    await import(stagingScript);

    expect(mocks.execFileSync).toHaveBeenNthCalledWith(1, 'npm.cmd', ['--version'], {
      encoding: 'utf8',
      shell: true,
    });
    expect(mocks.execFileSync).toHaveBeenNthCalledWith(
      2,
      'npm.cmd',
      ['exec', 'tauri', '--', '--version'],
      { encoding: 'utf8', shell: true },
    );
    expect(mocks.execFileSync).toHaveBeenNthCalledWith(3, 'rustc', ['--version'], {
      encoding: 'utf8',
      shell: true,
    });
    expect(mocks.execFileSync).toHaveBeenNthCalledWith(4, 'cargo', ['--version'], {
      encoding: 'utf8',
      shell: true,
    });

    const manifest = mocks.writeFileSync.mock.calls[0]?.[1];
    expect(manifest).toContain('npm: 11.19.0');
    expect(manifest).toContain('Tauri CLI: tauri 2.11.2');
  });
});
