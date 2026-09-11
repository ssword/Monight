import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'design/app-icon-2026/monight-native-default-1024.png');
const output = join(root, 'src-tauri/icons');
const cli = join(root, 'node_modules/@tauri-apps/cli/tauri.js');
const temporary = mkdtempSync(join(tmpdir(), 'monight-icons-'));

function generate(input, destination, quiet = false) {
  execFileSync(
    process.execPath,
    [cli, 'icon', input, '--output', destination, '--ios-color', '#0C182C'],
    { cwd: root, stdio: quiet ? 'pipe' : 'inherit' },
  );
}

try {
  generate(source, output);

  // Icon Composer exports the system-masked tile edge to edge. Legacy macOS
  // ICNS files need their own transparent inset to match the size of Dock icons.
  const artwork = readFileSync(source).toString('base64');
  const macSource = join(temporary, 'macos.svg');
  writeFileSync(
    macSource,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><image x="100" y="100" width="824" height="824" href="data:image/png;base64,${artwork}"/></svg>`,
  );
  const macOutput = join(temporary, 'macos');
  generate(macSource, macOutput, true);
  copyFileSync(join(macOutput, 'icon.icns'), join(output, 'icon.icns'));
  console.log(`Updated platform icons in ${resolve(output)}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
