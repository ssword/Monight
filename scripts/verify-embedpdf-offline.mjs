import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { verifyAnnotations } from './verify-embedpdf-annotations.mjs';
import { verifyNavigation } from './verify-embedpdf-navigation.mjs';
import { verifyReading } from './verify-embedpdf-reading.mjs';

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
  try {
    await renderedPages.first().waitFor({ state: 'visible', timeout: 10_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      status: document.body.dataset.status,
      error: document.body.dataset.error,
      smoke: window.embedPdfSmoke,
      shadowText: document
        .querySelector('embedpdf-container')
        ?.shadowRoot?.textContent?.replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500),
      shadowHtml: document
        .querySelector('embedpdf-container')
        ?.shadowRoot?.innerHTML.replace(/\s+/g, ' ')
        .slice(0, 1500),
    }));
    throw new Error(
      `EmbedPDF did not render a page image: ${JSON.stringify(state)}\n${browserDiagnostics.join('\n')}`,
      { cause: error },
    );
  }
  const renderedImages = await renderedPages.evaluateAll((images) =>
    images.filter(
      (image) =>
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0,
    ),
  );
  const renderedScriptInk = await renderedPages.evaluateAll((images) => {
    const maxInkPixels = { arabic: 0, cjk: 0, hebrew: 0 };
    for (const image of images) {
      if (!(image instanceof HTMLImageElement)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels) continue;
      const boxes = {
        cjk: [0.1, 0.25, 0.08, 0.15],
        arabic: [0.1, 0.25, 0.19, 0.24],
        hebrew: [0.1, 0.4, 0.27, 0.32],
      };
      for (const [script, [left, right, top, bottom]] of Object.entries(boxes)) {
        let inkPixels = 0;
        for (
          let y = Math.floor(canvas.height * top);
          y < Math.ceil(canvas.height * bottom);
          y += 1
        ) {
          for (
            let x = Math.floor(canvas.width * left);
            x < Math.ceil(canvas.width * right);
            x += 1
          ) {
            const index = (y * canvas.width + x) * 4;
            if (pixels[index] < 220 || pixels[index + 1] < 220 || pixels[index + 2] < 220) {
              inkPixels += 1;
            }
          }
        }
        maxInkPixels[script] = Math.max(maxInkPixels[script], inkPixels);
      }
    }
    return maxInkPixels;
  });
  const result = await page.evaluate(() => ({
    status: document.body.dataset.status,
    error: document.body.dataset.error,
    state: window.embedPdfSmoke,
    linkCandidates: [
      ...(document.querySelector('embedpdf-container')?.shadowRoot?.querySelectorAll('*') ?? []),
    ]
      .filter(
        (element) => element.style.cursor === 'pointer' || element.style.pointerEvents === 'auto',
      )
      .map((element) => ({
        style: element.getAttribute('style'),
        html: element.outerHTML.slice(0, 300),
        parents: (() => {
          const parents = [];
          let parent = element.parentElement;
          for (let depth = 0; parent && depth < 12; depth += 1) {
            parents.push({
              tag: parent.tagName,
              id: parent.id,
              className: parent.getAttribute('class'),
              data: { ...parent.dataset },
              style: parent.getAttribute('style'),
            });
            parent = parent.parentElement;
          }
          return parents;
        })(),
      }))
      .slice(0, 20),
  }));

  if (result.status !== 'ready') {
    throw new Error(
      `${result.error || 'EmbedPDF smoke failed'}: ${JSON.stringify(result.linkCandidates)}\n${browserDiagnostics.join('\n')}`,
    );
  }
  if (result.state?.pageCount !== 2 || result.state.currentPage !== 2) {
    throw new Error(`Invalid EmbedPDF state: ${JSON.stringify(result.state)}`);
  }
  if (
    result.state.linkPage !== 2 ||
    result.state.linkLocation < 0.2 ||
    result.state.linkLocation > 0.3 ||
    result.state.pageAfterLinkClick !== 1
  ) {
    throw new Error(`EmbedPDF bypassed Monight link routing: ${JSON.stringify(result.state)}`);
  }
  if (result.state.zoom <= result.state.initialZoom) {
    throw new Error(`EmbedPDF zoom did not change: ${JSON.stringify(result.state)}`);
  }
  if (renderedImages.length === 0)
    throw new Error('EmbedPDF did not render a non-empty page image');
  for (const [script, inkPixels] of Object.entries(renderedScriptInk)) {
    if (inkPixels < 10) {
      throw new Error(
        `EmbedPDF rendered no visible ${script} fallback glyph pixels: ${JSON.stringify(renderedScriptInk)}`,
      );
    }
  }
  if (externalRequests.length > 0) {
    throw new Error(`EmbedPDF requested external assets: ${externalRequests.join(', ')}`);
  }
  if (!localFontRequests.includes('/embedpdf/fonts/NotoSansHans-Regular.otf')) {
    throw new Error(`EmbedPDF did not preload the local CJK fallback font: ${localFontRequests}`);
  }
  for (const font of [
    'MonightMultiscriptFallback-Regular.ttf',
    'NotoNaskhArabic-Regular.ttf',
    'NotoSansHebrew-Regular.ttf',
  ]) {
    if (!localFontRequests.includes(`/embedpdf/fonts/${font}`)) {
      throw new Error(`EmbedPDF did not preload the local fallback font ${font}`);
    }
  }
  console.log(
    `EmbedPDF offline smoke passed: ${result.state.pageCount} page(s), zoom ${result.state.zoom}`,
  );
  await verifyReading(browser, origin);
  await verifyAnnotations(page, origin);
  if (browserDiagnostics.some((entry) => entry.includes('monight-test-password'))) {
    throw new Error('The protected-document password entered browser diagnostics');
  }
  await verifyNavigation(browser, origin);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
