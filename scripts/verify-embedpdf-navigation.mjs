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
  const search = page.locator('#toolbar-search');
  const monightSidebar = page.locator('#reader-sidebar');
  const results = monightSidebar.locator('.search-result');
  // Find focuses Monight's toolbar Search field; the ready-made search panel is gone.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Meta+F');
  await page.waitForFunction(() => document.activeElement?.id === 'toolbar-search');
  assert.equal(
    await viewer.locator('[data-sidebar-id="search-panel"]').count(),
    0,
    'The ready-made search panel must not be reachable',
  );
  assert.equal(await viewer.getByRole('button', { name: 'Search', exact: true }).count(), 0);
  assert.equal(await monightSidebar.isHidden(), true);
  await search.fill('moon');
  await results.nth(2).waitFor({ state: 'visible' });
  assert.equal(await monightSidebar.getAttribute('data-sidebar-mode'), 'search');
  assert.deepEqual(await monightSidebar.locator('.search-result-page').allTextContents(), [
    'Page 1',
    'Page 2',
  ]);
  assert.deepEqual(await results.locator('mark').allTextContents(), ['moon', 'moon', 'moon']);
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => ({
    snapshot: window.navigationSmoke.reader.snapshot(),
    text: document.getElementById('reader-sidebar').textContent,
  }));
  const matches = await page.evaluate(() => window.navigationSmoke.reader.query().search('sun'));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].pageNumber, 3);
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    snapshot: window.navigationSmoke.reader.snapshot(),
    text: document.getElementById('reader-sidebar').textContent,
  }));
  assert.deepEqual(
    after,
    before,
    'Document Queries must not alter interactive search or Reading Session',
  );
  await page.evaluate(() => {
    window.navigationSmoke.actions.length = 0;
  });
  await results.filter({ hasText: 'moon second page' }).click();
  await page.waitForFunction(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition.page === 2,
  );
  await page.waitForTimeout(600);
  const navigation = await page.evaluate(() => ({
    actions: window.navigationSmoke.actions,
    position: window.navigationSmoke.reader.snapshot().documents[0].readingPosition,
  }));
  assert.deepEqual(
    navigation.actions.map((action) => action.type),
    ['activateDocumentTarget'],
    'A search result must go to its hit through one go-to-target Reader Action',
  );
  // Exercise the retained shortcut matcher with a real input event in the field.
  await search.focus();
  await search.press('ArrowRight');
  assert.deepEqual(
    await page.evaluate(() => window.navigationSmoke.shortcuts),
    ['find'],
    'Caret keys inside the Search field must not become Reader Actions',
  );
  // Clearing the search restores the hidden sidebar without persisting the takeover.
  await search.fill('');
  await monightSidebar.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => window.navigationSmoke.chromePreferences.snapshot().sidebarMode),
    'thumbnails',
  );
  await viewer.getByRole('button', { name: 'Sidebar', exact: true }).click();
  // Monight's own sidebar replaces the ready-made Thumbnails tab; the outline remains.
  await viewer.locator('.outline-tree').waitFor({ state: 'visible' });
  const readyMadeSidebar = viewer.locator('[data-sidebar-id="sidebar-panel"]');
  assert.equal(await readyMadeSidebar.getByRole('tab').count(), 0);
  assert.equal(
    await readyMadeSidebar.locator('img[src^="blob:"]').count(),
    0,
    'The ready-made thumbnail panel must not be reachable',
  );
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
  await page.evaluate(async () => {
    await window.navigationSmoke.reader.dispatch({ type: 'goToPage', page: 3 });
  });
  await page.waitForFunction(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition.page === 3,
  );
  await viewer.getByRole('button', { name: 'Sidebar', exact: true }).click();
  await search.fill('moon');
  await results.nth(2).waitFor({ state: 'visible' });
  await results.nth(1).click();
  await page.waitForFunction(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition.page === 1,
  );
  await page.waitForTimeout(600);
  const repeatedPosition = await page.evaluate(
    () => window.navigationSmoke.reader.snapshot().documents[0].readingPosition,
  );
  assert.ok(
    repeatedPosition.location > 0.3 && repeatedPosition.location < 0.6,
    `The lower occurrence must settle beyond the first page-1 match: ${JSON.stringify(repeatedPosition)}`,
  );
  await search.fill('');
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
  assert.equal(await search.inputValue(), '', 'A cleared search must stay cleared');
  await search.fill('absent');
  await monightSidebar.getByText('No results').waitFor();
  assert.equal(await results.count(), 0);
  await search.fill('moon');
  await results.filter({ hasText: 'moon second page' }).waitFor();
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
    await results.filter({ hasText: 'moon second page' }).isVisible(),
    'A failed read-only query must not clear interactive results',
  );
  await page.evaluate(() => window.navigationSmoke.failNextSearch());
  await search.fill('failure');
  await monightSidebar.getByText('No results').waitFor();
  assert.equal(await results.count(), 0, 'Search failures must clear previous results');
  // Switching Documents re-runs the active search on the newly active Document.
  await search.fill('moon');
  await results.first().waitFor();
  await page.evaluate(() =>
    window.navigationSmoke.reader.dispatch({
      type: 'activateDocument',
      filePath: '/docs/first.pdf',
    }),
  );
  await results.nth(2).waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.navigationSmoke.actions.length = 0;
  });
  await results.filter({ hasText: 'moon second page' }).click();
  await page.waitForFunction(() => window.navigationSmoke.actions.length > 0);
  assert.equal(
    await page.evaluate(() => window.navigationSmoke.actions[0].filePath),
    '/docs/first.pdf',
    'Results must belong to the newly active Document',
  );
  await search.fill('');
  await monightSidebar.waitFor({ state: 'hidden' });
  assert.deepEqual(
    externalRequests,
    [],
    'Navigation must work without requesting external assets or URLs',
  );
  await page.close();
  console.log('EmbedPDF navigation contract passed');
}
