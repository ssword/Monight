import assert from 'node:assert/strict';

export async function verifyReading(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (/^https?:$/.test(url.protocol) && url.origin !== origin) await route.abort();
    else await route.continue();
  });
  await page.goto(`${origin}/embedpdf-reading-smoke.html`);
  await page.waitForFunction(() => document.body.dataset.status !== 'loading');
  assert.equal(
    await page.getAttribute('body', 'data-status'),
    'ready',
    await page.getAttribute('body', 'data-error'),
  );
  const viewer = page.locator('.embedpdf-document-surface[data-visible="true"]');
  await viewer.locator('img[src^="blob:"]').first().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.waitForTimeout(300);
  const filters = await viewer.evaluate((surface) => {
    const container = surface.querySelector('embedpdf-container');
    const root = container.shadowRoot;
    const inheritedFilters = (element) => {
      const filters = [];
      while (element) {
        const filter = getComputedStyle(element).filter;
        if (filter !== 'none') filters.push(filter);
        element = element.parentElement ?? element.getRootNode().host;
      }
      return filters;
    };
    return {
      page: inheritedFilters(root.querySelector('img[src^="blob:"]')),
      chrome: inheritedFilters(root.querySelector('button')),
    };
  });
  assert.equal(filters.page.length, 1, 'A preset must filter the reading surface exactly once');
  assert.deepEqual(filters.chrome, [], 'A preset must not filter viewer chrome');
  await page.evaluate(async () => {
    await window.readingSmoke.reader.dispatch({
      type: 'activateDocumentTarget',
      target: { readingPosition: { page: 2, location: 0.25 } },
    });
    await window.readingSmoke.reader.dispatch({
      type: 'setZoomIntent',
      zoomIntent: { kind: 'manual', scale: 2 },
    });
  });
  await page.waitForTimeout(600);
  const position = await page.evaluate(() => ({
    live: window.readingSmoke.workspace.activeReadingPosition().readingPosition,
    saved: window.readingSmoke.reader.snapshot().documents[0].readingPosition,
  }));
  assert.equal(position.live.page, 2);
  assert.ok(
    Math.abs(position.live.location - 0.25) < 0.01,
    `Zoom must preserve the page-relative anchor: ${JSON.stringify(position)}`,
  );
  assert.deepEqual(position.saved, { page: 2, location: 0.25 });
  await page.evaluate(() =>
    window.readingSmoke.reader.dispatch({
      type: 'setZoomIntent',
      zoomIntent: { kind: 'fit-width' },
    }),
  );
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(700);
  const resized = await page.evaluate(() => ({
    live: window.readingSmoke.workspace.activeReadingPosition().readingPosition,
    document: window.readingSmoke.reader.snapshot().documents[0],
  }));
  assert.equal(resized.document.visualState.zoomIntent.kind, 'fit-width');
  assert.equal(resized.live.page, 2);
  assert.ok(
    Math.abs(resized.live.location - 0.25) < 0.01,
    `Resize must preserve the anchor: ${JSON.stringify(resized)}`,
  );

  // Focus the document surface, so the event crosses the viewer's shadow boundary.
  await viewer.locator('embedpdf-container').evaluate((element) => {
    element.tabIndex = 0;
    element.focus();
  });
  await page.evaluate(() => {
    window.readingSmoke.actions.length = 0;
  });
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(600);
  const shortcut = await page.evaluate(() => ({
    actions: window.readingSmoke.actions,
    state: window.readingSmoke.workspace.activeRenderingState(),
    document: window.readingSmoke.reader.snapshot().documents[0],
  }));
  assert.deepEqual(
    shortcut.document.visualState.zoomIntent,
    { kind: 'manual', scale: 1 },
    'Monight reset zoom must win over EmbedPDF fit page',
  );
  assert.equal(
    shortcut.actions.filter((action) => action.type === 'setZoomIntent').length,
    1,
    'A shortcut must execute only once',
  );
  // A custom binding replaces the default even when it collides with a viewer tool.
  await page.evaluate(() =>
    window.readingSmoke.manager.loadFromSettings({
      keybinds: {
        custom: { action: 'zoomIn', binds: ['h'] },
      },
    }),
  );
  await page.keyboard.press('h');
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => window.readingSmoke.workspace.activeRenderingState().zoom),
    1.2,
  );
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => window.readingSmoke.workspace.activeRenderingState().zoom),
    1.2,
    'An unbound old viewer shortcut must not run',
  );
  const command = (id) =>
    page.evaluate(async (id) => {
      const container = document.querySelector(
        '.embedpdf-document-surface[data-visible="true"] embedpdf-container',
      );
      const registry = await container.registry;
      registry.getPlugin('commands').provides().execute(id, undefined, 'ui');
    }, id);
  await command('zoom:in');
  await page.waitForTimeout(400);
  const viewerZoom = await page.evaluate(() => ({
    live: window.readingSmoke.workspace.activeRenderingState().zoomIntent,
    saved: window.readingSmoke.reader.snapshot().documents[0].visualState.zoomIntent,
  }));
  assert.deepEqual(viewerZoom.live, { kind: 'manual', scale: 1.4 });
  assert.deepEqual(
    viewerZoom.saved,
    viewerZoom.live,
    'Ready-made relative zoom must persist the resulting scale',
  );
  await command('rotate:clockwise');
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(
      () => window.readingSmoke.reader.snapshot().documents[0].visualState.rotation,
    ),
    90,
  );
  await command('rotate:counter-clockwise');
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    const container = document.querySelector(
      '.embedpdf-document-surface[data-visible="true"] embedpdf-container',
    );
    const registry = await container.registry;
    const commands = registry.getPlugin('commands').provides();
    commands.execute('rotate:clockwise', undefined, 'ui');
    await new Promise(requestAnimationFrame);
    commands.execute('rotate:clockwise', undefined, 'ui');
  });
  await page.waitForTimeout(400);
  const rapidRotation = await page.evaluate(() => ({
    saved: window.readingSmoke.reader.snapshot().documents[0].visualState.rotation,
    live: window.readingSmoke.workspace.activeRenderingState().rotation,
  }));
  assert.deepEqual(
    rapidRotation,
    { saved: 180, live: 180 },
    'A second viewer rotation during projection must not be lost',
  );
  await command('rotate:counter-clockwise');
  await page.waitForTimeout(400);
  await command('rotate:counter-clockwise');
  await page.waitForTimeout(400);
  await command('spread:odd');
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(
      () => window.readingSmoke.reader.snapshot().documents[0].visualState.viewMode,
    ),
    'spread',
  );
  await command('scroll:vertical');
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(
      () => window.readingSmoke.reader.snapshot().documents[0].visualState.viewMode,
    ),
    'continuous',
    'Vertical reading must return to the supported continuous layout',
  );

  const scenarios = [
    {
      path: '/docs/first.pdf',
      viewMode: 'continuous',
      rotations: 0,
      zoomIntent: { kind: 'manual', scale: 2 },
      position: { page: 2, location: 0.25 },
    },
    {
      path: '/docs/second.pdf',
      viewMode: 'single',
      rotations: 1,
      zoomIntent: { kind: 'fit-width' },
      position: { page: 2, location: 0 },
    },
    {
      path: '/docs/third.pdf',
      viewMode: 'spread',
      rotations: 2,
      zoomIntent: { kind: 'fit-page' },
      position: { page: 1, location: 0 },
    },
  ];
  for (const scenario of scenarios) {
    await page.evaluate(async (scenario) => {
      const { reader, intake } = window.readingSmoke;
      await intake.open([scenario.path]);
      await reader.dispatch({ type: 'setViewMode', viewMode: scenario.viewMode });
      for (let turn = 0; turn < scenario.rotations; turn++)
        await reader.dispatch({ type: 'rotateClockwise' });
      await reader.dispatch({ type: 'setZoomIntent', zoomIntent: scenario.zoomIntent });
      await reader.dispatch({
        type: 'activateDocumentTarget',
        target: { readingPosition: scenario.position },
      });
    }, scenario);
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => ({
      live: window.readingSmoke.workspace.activeRenderingState(),
      saved: window.readingSmoke.reader
        .snapshot()
        .documents.find(
          ({ filePath }) => filePath === window.readingSmoke.reader.snapshot().activeDocumentPath,
        ),
    }));
    assert.equal(state.live.viewMode, scenario.viewMode);
    assert.equal(state.live.rotation, scenario.rotations * 90);
    assert.deepEqual(state.saved.readingPosition, scenario.position);
    assert.deepEqual(state.saved.visualState.zoomIntent, scenario.zoomIntent);
  }
  const duplicate = await page.evaluate(() =>
    window.readingSmoke.intake.open(['/alias/first.pdf']),
  );
  assert.equal(duplicate.activated, 1);
  assert.equal(await viewer.count(), 1);
  const saved = await page.evaluate(async () => {
    await window.readingSmoke.reader.flush();
    return JSON.parse(localStorage.getItem('reading-session'));
  });
  assert.deepEqual(
    saved.documents.map(({ filePath }) => filePath),
    scenarios.map(({ path }) => path),
  );
  assert.equal(saved.activeDocumentPath, '/docs/first.pdf');
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.status !== 'loading');
  assert.equal(
    await page.getAttribute('body', 'data-status'),
    'ready',
    await page.getAttribute('body', 'data-error'),
  );
  await page.waitForTimeout(600);
  const restored = await page.evaluate(() => window.readingSmoke.reader.snapshot());
  assert.deepEqual(
    restored.documents,
    saved.documents,
    'A subsequent launch must restore settled per-Document state',
  );
  assert.equal(restored.activeDocumentPath, saved.activeDocumentPath);
  for (const scenario of scenarios) {
    await page.getByRole('tab', { name: scenario.path.split('/').pop(), exact: true }).click();
    await page.waitForTimeout(500);
    const live = await page.evaluate(() => window.readingSmoke.workspace.activeRenderingState());
    assert.equal(live.rotation, scenario.rotations * 90);
    assert.equal(live.viewMode, scenario.viewMode);
    assert.deepEqual(live.zoomIntent, scenario.zoomIntent);
  }
  // Presentation is a transient projection; restoring it must not persist fit-page.
  const presentation = await page.evaluate(async () => {
    const { reader, workspace } = window.readingSmoke;
    const before = reader.snapshot();
    const surface = workspace.activePresentation();
    const original = surface.snapshot();
    await surface.setViewMode('single');
    await surface.fitToPage();
    await surface.setViewMode(original.viewMode);
    await surface.setZoomIntent(original.zoomIntent);
    return { before, after: reader.snapshot() };
  });
  assert.deepEqual(
    presentation.after,
    presentation.before,
    'Presentation must not persist transient visual state',
  );
  await page.evaluate(() =>
    window.readingSmoke.reader.dispatch({ type: 'activateDocument', filePath: '/docs/first.pdf' }),
  );
  const transform = await page.evaluate(() =>
    window.readingSmoke.workspace.viewTransform('/docs/first.pdf'),
  );
  assert.equal(transform.viewingRotation, 0);
  assert.equal(transform.scale, 2);
  assert.deepEqual(transform.zoomIntent, { kind: 'manual', scale: 2 });
  assert.match(transform.filterCss, /invert\(0.95\)/);
  const gestureFocus = () =>
    viewer.locator('img[src^="blob:"]').evaluateAll((images) => {
      const page = images
        .map((image) => image.getBoundingClientRect())
        .find(
          (rect) => rect.left <= 450 && rect.right >= 450 && rect.top <= 400 && rect.bottom >= 400,
        );
      return page ? { x: (450 - page.left) / page.width, y: (400 - page.top) / page.height } : null;
    });
  const focusBefore = await gestureFocus();
  assert.ok(focusBefore);
  await page.mouse.move(450, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(700);
  const gesture = await page.evaluate(() => ({
    live: window.readingSmoke.workspace.activeRenderingState(),
    position: window.readingSmoke.workspace.activeReadingPosition().readingPosition,
    saved: window.readingSmoke.reader.snapshot().documents[0],
  }));
  assert.ok(gesture.live.zoom > 2, 'A supported Ctrl-wheel gesture must zoom the reading surface');
  assert.deepEqual(gesture.saved.visualState.zoomIntent, gesture.live.zoomIntent);
  assert.equal(gesture.saved.readingPosition.page, gesture.position.page);
  assert.ok(Math.abs(gesture.saved.readingPosition.location - gesture.position.location) < 0.01);
  const focusAfter = await gestureFocus();
  assert.ok(focusAfter);
  assert.ok(
    Math.abs(focusAfter.x - focusBefore.x) < 0.01 && Math.abs(focusAfter.y - focusBefore.y) < 0.01,
    `Gesture zoom must preserve the point under the pointer: ${JSON.stringify({ focusBefore, focusAfter })}`,
  );

  // Corrupt and duplicate saved paths go through the same transactional startup flow.
  await page.evaluate(async () => {
    await window.readingSmoke.reader.flush();
    const saved = JSON.parse(localStorage.getItem('reading-session'));
    saved.documents.push({ ...saved.documents[0], filePath: '/alias/first.pdf' });
    saved.documents.push({
      ...saved.documents[0],
      filePath: '/docs/broken.pdf',
      title: 'broken.pdf',
    });
    saved.activeDocumentPath = '/docs/broken.pdf';
    localStorage.setItem('reading-session', JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.status !== 'loading');
  assert.equal(
    await page.getAttribute('body', 'data-status'),
    'ready',
    await page.getAttribute('body', 'data-error'),
  );
  const failedRestore = await page.evaluate(() => ({
    snapshot: window.readingSmoke.reader.snapshot(),
    result: window.readingSmoke.restoration,
    failures: window.readingSmoke.failures,
  }));
  assert.deepEqual(
    failedRestore.snapshot.documents.map(({ filePath }) => filePath),
    scenarios.map(({ path }) => path),
  );
  assert.equal(failedRestore.snapshot.activeDocumentPath, '/docs/first.pdf');
  assert.equal(failedRestore.result.failed, 1);
  assert.equal(failedRestore.failures.length, 1);
  assert.equal(
    await page.locator('.embedpdf-document-surface').count(),
    3,
    'Failed restoration must dispose its provisional viewer',
  );
  await page.evaluate(() => window.readingSmoke.intake.open(['/docs/native.pdf']));
  const originalBytes = await page.evaluate(async () =>
    Array.from(await window.readingSmoke.contents.get('/docs/native.pdf').getData()),
  );
  assert.match(new TextDecoder().decode(new Uint8Array(originalBytes)), /\/Rotate 90/);
  for (const rotation of [0, 90, 180, 270]) {
    await page.evaluate(async (rotation) => {
      const { reader } = window.readingSmoke;
      if (rotation) await reader.dispatch({ type: 'rotateClockwise' });
      await reader.dispatch({ type: 'setZoomIntent', zoomIntent: { kind: 'manual', scale: 2 } });
      await reader.dispatch({
        type: 'activateDocumentTarget',
        target: { readingPosition: { page: 2, location: 0.25 } },
      });
    }, rotation);
    await page.waitForTimeout(400);
    const native = await page.evaluate(async () => ({
      transform: window.readingSmoke.workspace.viewTransform('/docs/native.pdf'),
      position: window.readingSmoke.workspace.activeReadingPosition().readingPosition,
      bytes: Array.from(await window.readingSmoke.contents.get('/docs/native.pdf').getData()),
    }));
    assert.equal(
      native.transform.viewingRotation,
      rotation,
      'Viewing rotation must exclude the PDF native orientation',
    );
    assert.equal(native.position.page, 2);
    assert.ok(
      Math.abs(native.position.location - 0.25) < 0.01,
      `Native orientation anchor: ${JSON.stringify(native.position)}`,
    );
    assert.deepEqual(
      native.bytes,
      originalBytes,
      'Viewing transforms must leave Document Content bytes unchanged',
    );
  }
  await page.close();
  console.log('EmbedPDF Reading Session contract passed');
}
