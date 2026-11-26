import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openReaderChrome } from './embedpdf-reader-chrome.mjs';

const fixtureDirectory = new URL('../src-tauri/tests/fixtures/tester-kit/', import.meta.url);
const invalidName = 'invalid-document.pdf';
const validNames = ['valid-document-a.pdf', 'valid-document-b.pdf'];
const filePath = (name) => `/smoke/${name}`;
const expectedMessage = `Monight could not read “${invalidName}” as a PDF.`;

export async function verifyInvalidPdfIntake(browser, origin) {
  const results = [];
  for (const names of [[invalidName], [validNames[0], invalidName, validNames[1]]]) {
    const { page, close } = await openReaderChrome(browser, origin);
    try {
      for (const name of names) {
        const bytes = await readFile(new URL(name, fixtureDirectory));
        await page.evaluate(
          ({ path, base64 }) => {
            window.chromeSmoke.addFile(
              path,
              Array.from(atob(base64), (byte) => byte.charCodeAt(0)),
            );
          },
          { path: filePath(name), base64: bytes.toString('base64') },
        );
      }
      const paths = names.map(filePath);
      await page.evaluate((paths) => window.chromeSmoke.chooseFiles(paths), paths);
      await page.locator('#splash-open-btn').click();
      await page.waitForFunction(() => window.chromeSmoke.errorToasts.length > 0, undefined, {
        timeout: 5_000,
      });
      assert.deepEqual(
        await page.locator('.tab-title').allTextContents(),
        names.filter((name) => name !== invalidName),
        'Valid Documents should still open',
      );
      results.push(await page.evaluate(() => window.chromeSmoke.errorToasts));
    } finally {
      await close();
    }
  }
  assert.deepEqual(results, [[expectedMessage], [expectedMessage]]);
  console.log('Invalid PDF intake passed for a single file and a mixed batch');
}
