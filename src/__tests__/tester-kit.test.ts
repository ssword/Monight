import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => new URL(`../../${path}`, import.meta.url);
const readProjectFile = (path: string): string => readFileSync(projectPath(path), 'utf8');
const expectContainsAll = (contents: string, expectedValues: string[]) => {
  for (const value of expectedValues) expect(contents, value).toContain(value);
};

describe('release-candidate tester kit', () => {
  it('ships a documented, regenerable fixture inventory', () => {
    const fixtureGuide = readProjectFile('docs/release-candidate-fixtures.md');
    const expectedFixtures = [
      'valid-document-a.pdf',
      'valid-document-b.pdf',
      'invalid-document.pdf',
      'permission-restricted.pdf',
      'password-encrypted.pdf',
      'digitally-signed.pdf',
      'native-annotations/original.pdf',
      'native-annotations/annotated.pdf',
      'native-annotations/deleted.pdf',
      'preview-supported.pdf',
      'preview-unsupported.pdf',
      'acrobat-supported.pdf',
      'acrobat-unsupported.pdf',
      'fallback-font.pdf',
    ];

    expectContainsAll(fixtureGuide, expectedFixtures);
    expect(fixtureGuide).toContain('monight-test-password');
    expect(fixtureGuide).toMatch(/Purpose \| Provenance/);
    expect(existsSync(projectPath('scripts/generate-tester-pdf-fixtures.mjs'))).toBe(true);

    for (const fixture of ['valid-document-a.pdf', 'valid-document-b.pdf', 'fallback-font.pdf']) {
      expect(
        existsSync(projectPath(`src-tauri/tests/fixtures/tester-kit/${fixture}`)),
        fixture,
      ).toBe(true);
    }
    expect(
      statSync(projectPath('src-tauri/tests/fixtures/tester-kit/valid-document-b.pdf')).size,
    ).toBeGreaterThan(4_000_000);

    const fallbackPdf = readFileSync(
      projectPath('src-tauri/tests/fixtures/tester-kit/fallback-font.pdf'),
    ).toString('latin1');
    expect(fallbackPdf).toContain('4F60597D');
    expect(fallbackPdf).toContain('FEFF06440627');
    expect(fallbackPdf).toContain('FEFF05E905DC05D505DD');
    expect(fallbackPdf).not.toMatch(/\/FontFile(?:2|3)?\b/);
    expect(fallbackPdf).not.toContain('/Subtype /Type3');
    expect(fallbackPdf).not.toContain('3 Tr');
    expect(fallbackPdf).not.toMatch(/\b(?:m|l|c)\b[^\n]*\bf\b/);
  });

  it('maps every packaged and desktop smoke capability to executable steps', () => {
    const runbook = readProjectFile('docs/release-candidate-test-runbook.md');
    const requiredCapabilities = [
      'File dialog intake',
      'Drag-and-drop intake',
      'File association intake',
      'Command-line intake and canonical deduplication',
      'Ordered Documents and Reading Session restoration',
      'Search, outline, thumbnails, and links',
      'Reading Position, Visual State, filters, presets, and shortcuts',
      'Enabled Annotation tools, undo, and redo',
      'Save, Save As, aliases, open destinations, and external conflicts',
      'Edits during save and failed or uncertain writes',
      'Close and Quit: Save, Discard, Cancel, and cancellation recovery',
      'Recovery Draft: offer, restore, discard, and stale source',
      'Unsaved-Annotation printing without viewing transforms',
      'Restricted, signed, and encrypted Documents',
      'Offline runtime, fallback fonts, and enabled tools',
      'Auxiliary-window close',
      'External-link policy',
    ];

    expectContainsAll(runbook, requiredCapabilities);
    expect(runbook).toContain('Preview -> Monight -> Preview');
    expect(runbook).toContain('Monight -> Preview -> Monight');
    expect(runbook).toContain('Acrobat -> Monight -> Acrobat');
    expect(runbook).toContain('Monight -> Acrobat -> Monight');
    expect(runbook).toContain('native Annotation objects');
    expect(runbook).toContain('operating-system level');
    expect(runbook).toContain('application logs, temporary directories, caches, Reading Session');
    expect(runbook).toContain('Gatekeeper');
    expect(runbook).toContain('SmartScreen');
    expect(runbook).toContain('AppImage execution permissions');
    expect(runbook).toContain('not executed');
  });
});
