import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';

const platform = process.argv[2];
const projectRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const targetRoot = join(
  projectRoot,
  'src-tauri',
  'target',
  platform === 'macos' ? 'universal-apple-darwin' : '',
  'release',
  'bundle',
);
const stageRoot = join(projectRoot, 'release-candidate', platform ?? 'unknown');

const bundleExtensions = {
  linux: ['.deb', '.rpm', '.AppImage'],
  macos: ['.app', '.dmg'],
  windows: ['.exe', '.msi'],
};

if (!(platform in bundleExtensions)) {
  throw new Error(
    `Expected platform to be macos, windows, or linux; received ${platform ?? 'none'}`,
  );
}

function findEntries(root, extension) {
  const matches = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.name.endsWith(extension)) {
      matches.push(path);
    } else if (entry.isDirectory()) {
      matches.push(...findEntries(path, extension));
    }
  }

  return matches;
}

function findBundle(extension) {
  const matches = findEntries(targetRoot, extension);
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${extension} bundle under ${targetRoot}, found ${matches.length}`,
    );
  }
  return matches[0];
}

function commandVersion(command, args = ['--version']) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  return execFileSync(executable, args, { encoding: 'utf8' }).trim();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

rmSync(stageRoot, { force: true, recursive: true });
mkdirSync(stageRoot, { recursive: true });

const stagedBundles = bundleExtensions[platform].map((extension) => {
  const source = findBundle(extension);

  if (extension === '.app') {
    const destination = join(stageRoot, `${basename(source)}.tar.gz`);
    execFileSync('tar', ['-czf', destination, '-C', dirname(source), basename(source)], {
      stdio: 'inherit',
    });
    return destination;
  }

  const destination = join(stageRoot, basename(source));
  copyFileSync(source, destination);
  return destination;
});

const checksums = stagedBundles.map((path) => ({
  name: basename(path),
  sha256: sha256(path),
  size: statSync(path).size,
}));
const npmVersion = commandVersion('npm');
const tauriVersion = commandVersion('npm', ['exec', 'tauri', '--', '--version']);
const manifest = [
  `Commit: ${process.env.GITHUB_SHA ?? commandVersion('git', ['rev-parse', 'HEAD'])}`,
  `Application version: ${packageJson.version}`,
  `Platform: ${platform}`,
  `Node.js: ${process.version}`,
  `npm: ${npmVersion}`,
  `rustc: ${commandVersion('rustc')}`,
  `Cargo: ${commandVersion('cargo')}`,
  `Tauri CLI: ${tauriVersion}`,
  '',
  'Bundles:',
  ...checksums.map(({ name, sha256: checksum, size }) => `${checksum}  ${name}  ${size} bytes`),
  '',
].join('\n');

writeFileSync(join(stageRoot, 'manifest.txt'), manifest);

for (const { name, sha256: checksum } of checksums) {
  console.log(`SHA-256 (${name}) = ${checksum}`);
}
