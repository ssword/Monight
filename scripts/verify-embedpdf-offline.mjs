import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4178;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    './node_modules/vite/bin/vite.js',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

const waitForServer = async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${origin}/embedpdf-smoke.html`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the EmbedPDF smoke server');
};

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const externalRequests = [];
  const localFontRequests = [];
  const browserDiagnostics = [];
  page.on('console', (message) =>
    browserDiagnostics.push(`console ${message.type()}: ${message.text()}`),
  );
  page.on('pageerror', (error) => browserDiagnostics.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) =>
    browserDiagnostics.push(
      `request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
    ),
  );
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname.startsWith('/embedpdf/fonts/')) {
      localFontRequests.push(url.pathname);
    }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== origin) {
      externalRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.goto(`${origin}/embedpdf-smoke.html`);
  try {
    await page.waitForFunction(() => document.body.dataset.status !== 'loading');
  } catch (error) {
    const state = await page.evaluate(() => ({
      status: document.body.dataset.status,
      error: document.body.dataset.error,
      text: document.body.innerText,
      hasContainer: Boolean(document.querySelector('embedpdf-container')),
      shadowText: document
        .querySelector('embedpdf-container')
        ?.shadowRoot?.textContent?.replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500),
    }));
    throw new Error(
      `EmbedPDF did not settle: ${JSON.stringify(state)}\n${browserDiagnostics.join('\n')}`,
      { cause: error },
    );
  }
  const renderedPages = page.locator('embedpdf-container img[src^="blob:"]');
  await renderedPages.first().waitFor({ state: 'visible', timeout: 10_000 });
  const renderedImages = await renderedPages.evaluateAll((images) =>
    images.filter(
      (image) =>
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0,
    ),
  );
  const renderedInkPixels = await renderedPages.evaluateAll((images) => {
    let maxInkPixels = 0;
    for (const image of images) {
      if (!(image instanceof HTMLImageElement)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels) continue;
      let inkPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 220 || pixels[index + 1] < 220 || pixels[index + 2] < 220) {
          inkPixels += 1;
        }
      }
      maxInkPixels = Math.max(maxInkPixels, inkPixels);
    }
    return maxInkPixels;
  });
  const result = await page.evaluate(() => ({
    status: document.body.dataset.status,
    error: document.body.dataset.error,
    state: window.embedPdfSmoke,
  }));

  if (result.status !== 'ready') throw new Error(result.error || 'EmbedPDF smoke failed');
  if (!result.state || result.state.pageCount !== 2 || result.state.currentPage !== 2) {
    throw new Error(`Invalid EmbedPDF state: ${JSON.stringify(result.state)}`);
  }
  if (result.state.zoom <= result.state.initialZoom) {
    throw new Error(`EmbedPDF zoom did not change: ${JSON.stringify(result.state)}`);
  }
  if (renderedImages.length === 0)
    throw new Error('EmbedPDF did not render a non-empty page image');
  if (renderedInkPixels < 10) {
    throw new Error('EmbedPDF rendered the required-font fixture without visible glyph pixels');
  }
  if (externalRequests.length > 0) {
    throw new Error(`EmbedPDF requested external assets: ${externalRequests.join(', ')}`);
  }
  if (!localFontRequests.includes('/embedpdf/fonts/NotoSansHans-Regular.otf')) {
    throw new Error(`EmbedPDF did not preload the local CJK fallback font: ${localFontRequests}`);
  }
  console.log(
    `EmbedPDF offline smoke passed: ${result.state.pageCount} page(s), zoom ${result.state.zoom}`,
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
