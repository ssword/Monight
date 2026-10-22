// Shared driver for the EmbedPDF checks that exercise Monight's real reader
// chrome (embedpdf-chrome-smoke.html runs index.html and src/main.ts against an
// in-memory substitute for Tauri's native side).
import assert from 'node:assert/strict';

/** Opens the reader with its splash screen ready, blocking every request off the local origin. */
export async function openReaderChrome(browser, origin, contextOptions = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...contextOptions,
  });
  const page = await context.newPage();
  const externalRequests = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== origin) {
      externalRequests.push(url.href);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto(`${origin}/embedpdf-chrome-smoke.html`);
  // Startup ends by draining external open requests; the splash is interactive then.
  await page.waitForFunction(
    () =>
      window.chromeSmoke?.invocations.filter(({ cmd }) => cmd === 'take_external_open_payloads')
        .length >= 2,
    undefined,
    { timeout: 60_000 },
  );
  await page.locator('#splash-open-btn').waitFor({ state: 'visible' });
  return {
    page,
    externalRequests,
    errors,
    close: () => context.close(),
  };
}

/** Opens PDFs through the toolbar or splash Open button and its native dialog. */
export async function openDocuments(page, paths, opener = '#splash-open-btn') {
  await page.evaluate((files) => window.chromeSmoke.chooseFiles(files), paths);
  await page.click(opener);
  const name = paths.at(-1).split('/').pop();
  await page.waitForFunction(
    (fileName) => document.getElementById('file-name')?.textContent === fileName,
    name,
    { timeout: 60_000 },
  );
  await pageImage(page).waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(400);
}

/** The visible Document's first rendered page image. */
export const pageImage = (page) =>
  page.locator('.embedpdf-document-surface[data-visible="true"] img[src^="blob:"]').first();

/** Maps PDF page points (origin top-left) of the first visible page to window pixels. */
export async function pagePoint(page, x, y) {
  const box = await pageImage(page).boundingBox();
  assert.ok(box, 'Missing rendered page');
  const scale = box.width / 612;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

/** Selects page text by dragging across it, as a reader does. */
export async function selectText(page, from, to) {
  const start = await pagePoint(page, from.x, from.y);
  const end = await pagePoint(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Runs a native menu item by id, as its click does (reader-command event). */
export const runMenuCommand = (page, id) =>
  page.evaluate((commandId) => window.chromeSmoke.runMenuCommand(commandId), id);

/** A native menu item's state as the reader last set it. */
export const menuItem = (page, id) =>
  page.evaluate((itemId) => window.chromeSmoke.menuItem(itemId), id);

/** The toolbar's "Page N of M". */
export const pageStatus = (page) => page.textContent('#page-status');

/** The visible viewer's live state, read from its engine. */
export function viewerState(page) {
  return page.evaluate(async () => {
    const container = document.querySelector(
      '.embedpdf-document-surface[data-visible="true"] embedpdf-container',
    );
    const registry = await container.registry;
    const provides = (id) => registry.getPlugin(id).provides();
    const documentId = provides('document-manager').getActiveDocument().id;
    const zoom = provides('zoom').forDocument(documentId).getState();
    const document_ = provides('document-manager').getActiveDocument();
    return {
      zoom: zoom.currentZoomLevel,
      zoomLevel: zoom.zoomLevel,
      spreadMode: provides('spread').forDocument(documentId).getSpreadMode(),
      currentPage: provides('scroll').forDocument(documentId).getCurrentPage(),
      pageRotations: document_.pages.map(({ rotation }) => rotation),
      activeTool: provides('annotation').forDocument(documentId).getActiveTool()?.id ?? null,
      filter: container.style.getPropertyValue('--monight-reading-filter'),
    };
  });
}

/**
 * Every ready-made EmbedPDF interface element (toolbar, menu, panel, page
 * controls, selection menu, modal) currently rendered in any viewer. Monight's
 * chrome replaces all of them, so this must always be empty.
 */
export function readyMadeInterface(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('embedpdf-container')).flatMap((container) =>
      Array.from(
        container.shadowRoot?.querySelectorAll(
          'button, input, select, textarea, [role="menu"], [role="dialog"], [role="toolbar"], [data-epdf-i]',
        ) ?? [],
      )
        .filter((element) => element.checkVisibility() && element.getBoundingClientRect().width > 0)
        .map(
          (element) =>
            element.getAttribute('aria-label') ||
            element.getAttribute('data-epdf-i') ||
            element.tagName.toLowerCase(),
        ),
    ),
  );
}

export async function assertNoReadyMadeInterface(page, when) {
  assert.deepEqual(
    await readyMadeInterface(page),
    [],
    `No ready-made EmbedPDF interface may render ${when}`,
  );
}

/** The Highlights and Notes sidebar's entries for the active Document. */
export function listedAnnotations(page) {
  return page.locator('#reader-sidebar .sidebar-annotation').evaluateAll((entries) =>
    entries.map((entry) => ({
      id: entry.dataset.annotationId,
      kind: entry.dataset.annotationKind,
      text: entry.querySelector('.sidebar-annotation-text')?.textContent ?? '',
      color:
        entry
          .querySelector('.sidebar-annotation-swatch')
          ?.style.getPropertyValue('--sidebar-annotation-color')
          .toUpperCase() ?? null,
    })),
  );
}

/** Polls a check run in Node until it holds, failing with its last value. */
export async function until(check, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${message} (last: ${JSON.stringify(last)})`);
}

/** The run raised no page error or error toast and requested nothing off the local origin. */
export async function assertCleanRun({ page, errors, externalRequests }) {
  assert.deepEqual(errors, [], 'The reader raised page errors');
  assert.deepEqual(
    await page.evaluate(() => window.chromeSmoke.errorToasts),
    [],
    'The reader reported errors',
  );
  assert.deepEqual(externalRequests, [], 'The reader requested external assets');
}
