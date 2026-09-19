import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const design = join(root, 'design/app-icon-painted-2026');
const developer = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim();
const renderer = join(developer, 'Applications/Icon Composer.app/Contents/Executables/ictool');
mkdirSync(join(design, 'previews'), { recursive: true });

for (const rendition of [
  'Default',
  'Dark',
  'ClearLight',
  'ClearDark',
  'TintedLight',
  'TintedDark',
]) {
  execFileSync(
    renderer,
    [
      join(design, 'Monight.icon'),
      '--export-image',
      '--output-file',
      join(design, 'previews', `${rendition}.png`),
      '--platform',
      'macOS',
      '--rendition',
      rendition,
      '--width',
      '1024',
      '--height',
      '1024',
      '--scale',
      '1',
      '--design-generation',
      '27',
    ],
    { stdio: 'inherit' },
  );
}
