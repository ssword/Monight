import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyAnnotations(page, origin) {
  await page.goto(`${origin}/embedpdf-annotations-smoke.html`);
  await page.waitForFunction(() => document.body.dataset.status !== 'loading', { timeout: 30000 });
  const { status, error, result } = await page.evaluate(() => ({
    status: document.body.dataset.status,
    error: document.body.dataset.error,
    result: window.nativeAnnotationSmoke,
  }));
  assert.equal(status, 'ready', error);
  const highlight = result.annotations.find((object) => object.type === 9);
  const comment = result.annotations.find((object) => object.type === 1);
  assert.deepEqual(comment.rect, { origin: { x: 260, y: 104 }, size: { width: 20, height: 20 } });
  assert.deepEqual(highlight.segmentRects, [
    { origin: { x: 72, y: 50 }, size: { width: 160, height: 24 } },
  ]);
  if (process.argv.includes('--write-annotation-fixtures')) {
    const destination = 'src-tauri/tests/fixtures/native-annotations';
    await mkdir(destination, { recursive: true });
    for (const name of ['original', 'annotated', 'deleted'])
      await writeFile(`${destination}/${name}.pdf`, new Uint8Array(result[name]));
  }
  console.log(
    'EmbedPDF native highlight/comment create, undo/redo, export, reopen, select, edit, delete, re-save: PASS',
  );
}
