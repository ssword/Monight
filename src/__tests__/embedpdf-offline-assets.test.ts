import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => new URL(`../../${path}`, import.meta.url);

describe('EmbedPDF offline assets', () => {
  it('pins the audited production release and ships every configured local asset', () => {
    const manifest = JSON.parse(readFileSync(projectPath('package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const requiredAssets = [
      'public/embedpdf/pdfium.wasm',
      'public/embedpdf/fonts/NotoSans-Regular.ttf',
      'public/embedpdf/fonts/NotoSansHans-Regular.otf',
      'public/embedpdf/fonts/NotoSansHant-Regular.otf',
      'public/embedpdf/fonts/NotoSansJP-Regular.otf',
      'public/embedpdf/fonts/NotoSansKR-Regular.otf',
      'public/embedpdf/fonts/NotoNaskhArabic-Regular.ttf',
      'public/embedpdf/fonts/NotoSansHebrew-Regular.ttf',
    ];

    expect(manifest.dependencies['@embedpdf/snippet']).toBe('2.15.0');
    for (const asset of requiredAssets) {
      expect(existsSync(projectPath(asset)), asset).toBe(true);
      expect(statSync(projectPath(asset)).size, asset).toBeGreaterThan(10_000);
    }
  });
});
