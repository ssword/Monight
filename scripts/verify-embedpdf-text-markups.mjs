import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyTextMarkups(page, origin) {
  await page.goto(`${origin}/embedpdf-text-markup-smoke.html`);
  await page.waitForFunction(() => document.body.dataset.status !== 'loading', { timeout: 60000 });
  const { status, error, result } = await page.evaluate(() => ({
    status: document.body.dataset.status,
    error: document.body.dataset.error,
    result: window.textMarkupSmoke,
  }));
  assert.equal(status, 'ready', error);
  const destination = 'artifacts/text-markup-fixes';
  await mkdir(destination, { recursive: true });
  for (const name of ['contents', 'colour', 'moved', 'opaque', 'selection', 'fonts'])
    await writeFile(`${destination}/${name}.pdf`, new Uint8Array(result[name]));
  const image = page.locator('embedpdf-container img[src^="blob:"]').first();
  await image.waitFor({ state: 'visible' });
  const box = await image.boundingBox();
  assert.ok(box, 'Missing rendered font-fixture page');
  const scale = box.width / 612;
  for (const [index, tool, y, right] of [
    [0, 'underline', 65, 113],
    [1, 'strikeout', 125, 130],
    [2, 'highlight', 180, 225],
  ]) {
    await page.evaluate((tool) => window.textMarkupActive.start(tool), tool);
    await page.mouse.move(box.x + 73 * scale, box.y + y * scale);
    await page.mouse.down();
    await page.mouse.move(box.x + right * scale, box.y + y * scale, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction((count) => window.textMarkupActive.count() === count, index + 1);
  }
  const active = await page.evaluate(() => ({ objects: window.textMarkupActive.objects() }));
  // Keep the asynchronous export inside evaluate so Playwright awaits it.
  const activeBytes = await page.evaluate(() => window.textMarkupActive.finish());
  assert.equal(active.objects.length, 3);
  const underline = active.objects.find((object) => object.type === 10);
  assert.ok(
    underline.rect.origin.y + underline.rect.size.height < 77,
    'Active-tool underline still uses loose font bounds',
  );
  await writeFile(`${destination}/active.pdf`, new Uint8Array(activeBytes));
  console.log(
    `EmbedPDF native text-markup comment/visual edits and selection: PASS (${JSON.stringify(result.selected)})`,
  );
}
