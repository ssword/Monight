import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Runs the external-reader-to-Monight contract (#79) for every reader registered in
// src-tauri/tests/fixtures/external/manifest.json. With --write-annotation-fixtures it also
// refreshes the exports that the Rust preservation contract checks.
export async function verifyExternalReaders(page, origin) {
  await page.goto(`${origin}/embedpdf-external-readers-smoke.html`);
  await page.waitForFunction(() => document.body.dataset.status !== 'loading', { timeout: 60000 });
  const { status, error, exports } = await page.evaluate(() => ({
    status: document.body.dataset.status,
    error: document.body.dataset.error,
    exports: window.externalReaderSmoke,
  }));
  assert.equal(status, 'ready', error);
  if (process.argv.includes('--write-annotation-fixtures')) {
    const destination = 'src-tauri/tests/fixtures/external/exports';
    await mkdir(destination, { recursive: true });
    for (const { id, files } of exports)
      for (const [stage, bytes] of Object.entries(files))
        await writeFile(`${destination}/${id}-${stage}.pdf`, new Uint8Array(bytes));
  }
  for (const { id, knownFailures } of exports)
    for (const failure of knownFailures) console.log(`KNOWN FAILURE ${id}: ${failure}`);
  console.log(
    `EmbedPDF external-reader contracts (${exports.map(({ id }) => id).join(', ')}): PASS`,
  );
}
