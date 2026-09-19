import assert from 'node:assert/strict';

// More pages than the viewer's render buffer: three-page fixtures never evict
// a page above the viewport and cannot expose scroll-anchoring jumps.
function longPdf() {
  const pageCount = 30;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from(
      { length: pageCount },
      () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    ),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}

export async function verifyScrolling(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.context().route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (/^https?:$/.test(url.protocol) && url.origin !== origin) await route.abort();
      else await route.continue();
    });
    await page.goto(`${origin}/embedpdf-navigation-smoke.html`);
    await page.waitForFunction(() => document.body.dataset.status !== 'loading');
    assert.equal(await page.getAttribute('body', 'data-status'), 'ready');
    await page.evaluate(async (pdf) => {
      await window.navigationSmoke.workspace.intakeRuntime.open({
        document: { canonicalPath: '/docs/long.pdf', title: 'Long scrolling fixture' },
        bytes: new TextEncoder().encode(pdf),
        activate: true,
      });
    }, longPdf());
    await page.waitForTimeout(600);
    const metrics = () =>
      page.evaluate(async () => {
        const container = document.querySelector(
          '.embedpdf-document-surface[data-visible="true"] embedpdf-container',
        );
        const registry = await container.registry;
        const state = registry.getPlugin('scroll').provides().getMetrics();
        return { y: state.scrollOffset.y, firstRendered: state.renderedPageIndexes[0] };
      });
    await page.mouse.move(700, 450);
    let previous = await metrics();
    const initial = previous;
    // Cross multiple render-buffer boundaries in both directions.
    for (const delta of [100, -100]) {
      for (let step = 0; step < 65; step += 1) {
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(80);
        const current = await metrics();
        assert.ok(
          Math.abs(current.y - previous.y - delta) <= 2,
          `${browser.browserType().name()} wheel ${delta}px moved ${current.y - previous.y}px at ${previous.y}px (step ${step})`,
        );
        previous = current;
      }
      if (delta > 0) {
        assert.ok(previous.firstRendered > 0, 'Scrolling must evict pages above the viewport');
      }
    }
    assert.ok(Math.abs(previous.y - initial.y) <= 2, 'Reverse scrolling must return to the start');
    console.log(`EmbedPDF wheel scrolling passed (${browser.browserType().name()})`);
  } finally {
    await page.close();
  }
}
