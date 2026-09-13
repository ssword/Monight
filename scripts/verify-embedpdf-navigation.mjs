import assert from 'node:assert/strict';

export async function verifyNavigation(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const externalRequests = [];
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== origin) {
      externalRequests.push(url.href);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.goto(`${origin}/embedpdf-navigation-smoke.html`);
  await page.waitForFunction(() => document.body.dataset.status !== 'loading');
  assert.equal(await page.getAttribute('body', 'data-status'), 'ready');
  const viewer = page.locator('.embedpdf-document-surface[data-visible="true"]');
  await viewer.locator('img[src^="blob:"]').first().waitFor({ state: 'visible' });
  await page.evaluate(() => window.navigationSmoke.access().presentation.openSearch());
  const input = viewer.locator('input[type="text"]').last();
  await input.fill('moon');
  await page.waitForFunction(() =>
    document
      .querySelector('embedpdf-container')
      .shadowRoot.textContent.includes('moon lower match'),
  );
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => ({
    snapshot: window.navigationSmoke.reader.snapshot(),
    text: document.querySelector('embedpdf-container').shadowRoot.querySelector('[data-sidebar-id]')
      .textContent,
  }));
  const { matches, viewerQueries } = await page.evaluate(async () => {
    const registry = await document.querySelector('embedpdf-container').registry;
    const viewerQueries = [];
    const unsubscribe = registry
      .getPlugin('search')
      .provides()
      .onStateChange(({ state }) => viewerQueries.push(state.query));
    const matches = await window.navigationSmoke.reader.query().search('sun');
    unsubscribe();
    return { matches, viewerQueries };
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].pageNumber, 3);
  assert.ok(
    viewerQueries.every((query) => query === 'moon'),
    'A read-only query must not replace interactive search',
  );
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    snapshot: window.navigationSmoke.reader.snapshot(),
    text: document.querySelector('embedpdf-container').shadowRoot.querySelector('[data-sidebar-id]')
      .textContent,
  }));
  assert.deepEqual(
    after,
    before,
    'Document Queries must not alter interactive search or Reading Session',
  );
  await page.evaluate(() => {
    window.navigationSmoke.actions.length = 0;
  });
  await viewer.getByRole('button', { name: 'moon second page' }).click();
  await page.waitForFunction(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition.page === 2,
  );
  await page.waitForTimeout(600);
  const navigation = await page.evaluate(() => ({
    actions: window.navigationSmoke.actions,
    position: window.navigationSmoke.reader.snapshot().documents[0].readingPosition,
  }));
  assert.equal(
    navigation.actions.filter((action) => action.type === 'goToPage').length,
    0,
    'Completed viewer navigation must settle its position without a second page jump',
  );
  assert.ok(
    await viewer
      .getByRole('button', { name: 'moon second page' })
      .evaluate((button) => button.classList.contains('bg-accent-light')),
  );
  // Exercise the retained shortcut matcher with a real shadow-DOM input event.
  await input.focus();
  await input.press('ArrowRight');
  assert.deepEqual(
    await page.evaluate(() => window.navigationSmoke.shortcuts),
    [],
    'Caret keys inside the ready-made search field must not become Reader Actions',
  );
  await viewer.getByRole('button', { name: 'Sidebar', exact: true }).click();
  // The pinned snippet renders icon-only, unnamed Thumbnails / Outline tabs.
  await viewer.getByRole('tab').nth(1).click();
  await viewer.locator('.outline-tree').waitFor({ state: 'visible' });
  let popupOpened = false;
  page.on('popup', async (popup) => {
    popupOpened = true;
    await popup.close();
  });
  await viewer.getByText('Website', { exact: true }).click();
  await page.waitForTimeout(300);
  assert.deepEqual(
    await page.evaluate(() => window.navigationSmoke.externalUrls),
    ['https://example.com/outline'],
    'Outline URLs must go through the captured Document Reader Action and external-link adapter',
  );
  assert.equal(popupOpened, false, 'Outline links must not open a browser window directly');
  await viewer.getByText('Blocked website', { exact: true }).click();
  await page.waitForFunction(() => window.navigationSmoke.errors.length === 1);
  assert.equal(popupOpened, false);
  await viewer.getByText('Chapter', { exact: true }).first().click();
  await page.waitForFunction(() => {
    const position = window.navigationSmoke.reader.snapshot().documents[0].readingPosition;
    return position.page === 2 && Math.abs(position.location - 0.5) < 0.02;
  });
  await viewer.getByText('Nested chapter', { exact: true }).click();
  await page.waitForFunction(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition.page === 3,
  );
  await viewer.getByText('Chapter', { exact: true }).last().click();
  await page.waitForFunction(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition.page === 1,
  );
  const retained = await page.evaluate(async () => {
    const query = window.navigationSmoke.reader.query();
    const snapshot = window.navigationSmoke.reader.snapshot();
    const metadata = await query.metadata();
    const outline = await query.outline();
    const thumbnail = await query.thumbnail(3, { maxWidth: 100 });
    return {
      metadata,
      outline,
      thumbnail: [thumbnail.width, thumbnail.height],
      unchanged:
        JSON.stringify(snapshot) === JSON.stringify(window.navigationSmoke.reader.snapshot()),
    };
  });
  assert.equal(retained.metadata.title, '/docs/first.pdf');
  assert.equal(retained.metadata.pageCount, 3);
  assert.equal(retained.outline[0].pageNumber, 2);
  assert.equal(retained.outline[0].items[0].pageNumber, 3);
  assert.ok(retained.thumbnail[0] > 0 && retained.thumbnail[0] <= 100 && retained.thumbnail[1] > 0);
  assert.equal(retained.unchanged, true);
  await viewer.getByRole('tab').first().click();
  await viewer.locator('[data-sidebar-id="sidebar-panel"]').getByText('3', { exact: true }).click();
  await page.waitForFunction(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition.page === 3,
  );
  await viewer.getByRole('button', { name: 'Sidebar', exact: true }).click();
  await page.evaluate(() => window.navigationSmoke.access().presentation.openSearch());
  const reopenedInput = viewer.locator('input[type="text"]').last();
  await reopenedInput.fill('');
  await reopenedInput.fill('moon');
  const repeatedResults = viewer.getByRole('button', { name: 'moon first page moon lower match' });
  await repeatedResults.nth(1).waitFor({ state: 'visible' });
  await repeatedResults.nth(1).click();
  await page.waitForFunction(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition.page === 1,
  );
  await page.waitForTimeout(600);
  const repeatedPosition = await page.evaluate(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition,
  );
  assert.ok(
    repeatedPosition.location > 0.1 && repeatedPosition.location < 0.3,
    `The lower occurrence must settle beyond the first page-1 match: ${JSON.stringify(repeatedPosition)}`,
  );
  assert.ok(
    await repeatedResults.nth(1).evaluate((button) => button.classList.contains('bg-accent-light')),
    'The ready-made viewer must visibly select the second same-page occurrence',
  );
  await viewer.getByRole('button', { name: 'Search', exact: true }).click();
  await page.evaluate(async () => {
    await window.navigationSmoke.reader.dispatch({ type: 'goToPage', page: 1 });
  });
  await viewer.getByRole('button', { name: 'Toggle Pointer Mode' }).click();
  await page.waitForTimeout(300);
  const pageImage = viewer.locator('img[src^="blob:"]').first();
  const box = await pageImage.boundingBox();
  assert.ok(box);
  const scale = box.width / 612;
  await page.mouse.move(box.x + 73 * scale, box.y + 64 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 250 * scale, box.y + 64 * scale, { steps: 16 });
  await page.mouse.up();
  const selectedText = await page.evaluate(async () => {
    const registry = await document.querySelector('embedpdf-container').registry;
    return registry.getPlugin('selection').provides().getSelectedText().toPromise();
  });
  assert.match(selectedText.join(''), /moon first/);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('ControlOrMeta+C');
  await page.waitForFunction(async () =>
    (await navigator.clipboard.readText()).includes('moon first'),
  );
  // Page links use the same desktop adapter and precise destination action.
  await page.mouse.click(box.x + 450 * scale, box.y + 250 * scale);
  await page.mouse.click(box.x + 150 * scale, box.y + 125 * scale);
  await page.waitForFunction(() =>
    window.navigationSmoke.externalUrls.includes('https://example.com/page'),
  );
  await page.mouse.click(box.x + 150 * scale, box.y + 185 * scale);
  await page.waitForFunction(() => {
    const position = window.navigationSmoke.reader.snapshot().documents[0].readingPosition;
    return position.page === 2 && position.location === 0.5;
  });
  assert.equal(popupOpened, false);

  await page.evaluate(() => window.navigationSmoke.open('/docs/second.pdf'));
  await page.evaluate(() => window.navigationSmoke.access().presentation.openSearch());
  const secondInput = viewer.locator('input[type="text"]').last();
  assert.equal(
    await secondInput.inputValue(),
    '',
    'Another Document must not inherit search UI state',
  );
  await secondInput.fill('absent');
  await page.waitForTimeout(500);
  assert.equal(await viewer.getByRole('button', { name: /moon/ }).count(), 0);
  await secondInput.fill('moon');
  await viewer.getByRole('button', { name: 'moon second page' }).waitFor();
  const failedQuery = await page.evaluate(async () => {
    await window.navigationSmoke.failNextSearch();
    try {
      await window.navigationSmoke.reader.query().search('sun');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(failedQuery, true, 'Read-only query errors must reach their caller');
  assert.ok(
    await viewer.getByRole('button', { name: 'moon second page' }).isVisible(),
    'A failed read-only query must not clear interactive results',
  );
  await page.evaluate(() => window.navigationSmoke.failNextSearch());
  await secondInput.fill('failure');
  await page.waitForTimeout(500);
  assert.equal(
    await viewer.getByRole('button', { name: /moon/ }).count(),
    0,
    'Search failures must clear previous results',
  );
  await secondInput.fill('');
  await page.waitForTimeout(500);
  assert.equal(await viewer.getByRole('button', { name: /moon/ }).count(), 0);
  await page.evaluate(async () => {
    await window.navigationSmoke.reader.dispatch({
      type: 'closeDocument',
      filePath: '/docs/second.pdf',
    });
    await window.navigationSmoke.open('/docs/second.pdf');
    window.navigationSmoke.access().presentation.openSearch();
  });
  assert.equal(await viewer.locator('input[type="text"]').last().inputValue(), '');
  assert.deepEqual(
    externalRequests,
    [],
    'Navigation must work without requesting external assets or URLs',
  );
  await page.close();
  console.log('EmbedPDF navigation contract passed');
}
