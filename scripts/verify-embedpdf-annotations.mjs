import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  assertCleanRun,
  assertNoReadyMadeInterface,
  listedAnnotations,
  menuItem,
  openDocuments,
  openReaderChrome,
  pagePoint,
  runMenuCommand,
  selectText,
  until,
  viewerState,
} from './embedpdf-reader-chrome.mjs';

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
  assert.deepEqual(comment.rect, { origin: { x: 260, y: 100 }, size: { width: 24, height: 24 } });
  assert.deepEqual(highlight.segmentRects, [
    { origin: { x: 72, y: 50 }, size: { width: 160, height: 24 } },
  ]);
  if (process.argv.includes('--write-annotation-fixtures')) {
    const destination = 'src-tauri/tests/fixtures/native-annotations';
    await mkdir(destination, { recursive: true });
    for (const name of ['original', 'annotated', 'deleted', 'rotated'])
      await writeFile(`${destination}/${name}.pdf`, new Uint8Array(result[name]));
  }
  console.log('EmbedPDF protected printing and native annotated print round trips: PASS');
  await verifyAnnotationChrome(page.context().browser(), origin);
}

/** Whether PDF source holds a text string, as a literal or a UTF-16BE hex string. */
const holdsPdfText = (source, text) => {
  const utf16 = `FEFF${[...text].map((char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
  return (
    source.includes(`(${text})`) ||
    source.includes(`<${utf16.toUpperCase()}>`) ||
    source.includes(`<${utf16.toLowerCase()}>`)
  );
};

/** The Highlight split button's colours by id: HIGHLIGHT_COLORS, served by Vite. */
const highlightColors = async (page) =>
  Object.fromEntries(
    (
      await page.evaluate(async () => (await import('/src/app/markup-tools.ts')).HIGHLIGHT_COLORS)
    ).map((color) => [color.id, color]),
  );

/**
 * The markup toolbar, Highlight split button, Tools and Edit menus, and the
 * annotation menu (note, colour, Delete) edit a Document in the real reader,
 * and Save writes the edits; no ready-made annotation interface appears.
 */
export async function verifyAnnotationChrome(browser, origin) {
  const reader = await openReaderChrome(browser, origin);
  const { page } = reader;
  const annotationMenu = page.locator('#annotation-menu');
  const note = annotationMenu.getByRole('textbox', { name: 'Note' });
  const listed = (predicate, message) =>
    until(async () => {
      const entries = await listedAnnotations(page);
      return predicate(entries) ? entries : false;
    }, message);
  try {
    const { yellow, green: greenColor, blue } = await highlightColors(page);
    await openDocuments(page, ['/smoke/moon.pdf']);
    await runMenuCommand(page, 'view.sidebar.annotations');
    await page.locator('#reader-sidebar').getByText('No Highlights or Notes').waitFor();

    // Markup toolbar: the Text Note tool places a note, whose menu takes its text at once.
    await page.click('#markup-toolbar-toggle');
    await page.locator('#markup-toolbar').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Text Note', exact: true }).click();
    assert.equal((await viewerState(page)).activeTool, 'textComment');
    const notePoint = await pagePoint(page, 400, 300);
    await page.mouse.click(notePoint.x, notePoint.y);
    await annotationMenu.waitFor({ state: 'visible' });
    await assertNoReadyMadeInterface(page, 'with a note selected');
    await until(
      () => page.evaluate(() => document.activeElement?.classList.contains('annotation-menu-note')),
      'A new note did not take the typing',
    );
    await page.keyboard.type('Ask about the moon');
    await page.keyboard.press('Tab');
    const noted = await listed(
      (entries) =>
        entries.some(({ kind, text }) => kind === 'note' && text === 'Ask about the moon'),
      'The note text did not reach the Annotation',
    );
    const noteId = noted.find(({ kind }) => kind === 'note').id;
    // Tools ▸ Text Selection leaves the tool.
    await runMenuCommand(page, 'tools.text-selection');
    await until(async () => (await viewerState(page)).activeTool === null, 'Tool still active');
    assert.equal((await menuItem(page, 'tools.text-selection'))?.checked, true);
    assert.equal(await annotationMenu.isVisible(), true);
    await page.click('#file-name');
    await page.keyboard.press('Escape');

    // Highlight split button: marks the selection at once, in the chosen colour.
    await selectText(page, { x: 73, y: 65 }, { x: 195, y: 65 });
    await assertNoReadyMadeInterface(page, 'with page text selected');
    await page.click('#highlight-button');
    await listed(
      (entries) =>
        entries.some(({ kind, color }) => kind === 'highlight' && color === yellow.strokeColor),
      'Highlight did not mark the selection',
    );
    await page.click('#highlight-menu-toggle');
    await page.getByRole('menuitemradio', { name: greenColor.label }).click();
    await selectText(page, { x: 73, y: 365 }, { x: 260, y: 365 });
    await page.click('#highlight-button');
    const marked = await listed(
      (entries) =>
        entries.some(({ kind, color }) => kind === 'highlight' && color === greenColor.strokeColor),
      'Highlight did not use the chosen colour',
    );
    const green = marked.find(({ color }) => color === greenColor.strokeColor);

    // Tools ▸ Annotate offers the Highlight dropdown's tools too (here Underline).
    await runMenuCommand(page, 'tools.annotate.underline');
    await until(
      async () => (await viewerState(page)).activeTool === 'underline',
      'Tools ▸ Annotate ▸ Underline did not enter underline mode',
    );
    await selectText(page, { x: 215, y: 65 }, { x: 268, y: 65 });
    await listed(
      (entries) => entries.some(({ kind }) => kind === 'underline'),
      'Underline mode did not mark the selection',
    );
    await runMenuCommand(page, 'tools.text-selection');

    // The annotation menu edits a highlight chosen in Highlights and Notes.
    await page.locator(`.sidebar-annotation[data-annotation-id="${green.id}"]`).click();
    await annotationMenu.waitFor({ state: 'visible' });
    await assertNoReadyMadeInterface(page, 'with a highlight selected');
    await annotationMenu.getByRole('radio', { name: blue.label }).click();
    await listed(
      (entries) => entries.some(({ id, color }) => id === green.id && color === blue.strokeColor),
      'The colour did not reach the highlight',
    );
    await note.fill('Lower match');
    await note.press('Tab');
    await listed(
      (entries) => entries.some(({ id, text }) => id === green.id && text === 'Lower match'),
      'The note did not reach the highlight',
    );
    await annotationMenu.getByRole('button', { name: 'Delete' }).click();
    await listed(
      (entries) => !entries.some(({ id }) => id === green.id),
      'Delete did not remove the highlight',
    );
    await annotationMenu.waitFor({ state: 'hidden' });
    // Edit ▸ Undo restores it; the Delete key removes the selected Annotation again.
    await runMenuCommand(page, 'edit.undo');
    await listed(
      (entries) => entries.some(({ id }) => id === green.id),
      'Edit ▸ Undo did not restore the highlight',
    );
    await page.locator(`.sidebar-annotation[data-annotation-id="${green.id}"]`).click();
    await annotationMenu.waitFor({ state: 'visible' });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Delete');
    await listed(
      (entries) => !entries.some(({ id }) => id === green.id),
      'The Delete key did not remove the selected highlight',
    );

    // Rotate (toolbar) and Tools ▸ Rotate Right turn the current page in the PDF;
    // Edit ▸ Undo turns it back.
    const rotations = async () => (await viewerState(page)).pageRotations.join();
    await page.click('#rotate-pages');
    await until(
      async () => /^(3,0,0|0,3,0|0,0,3)$/.test(await rotations()),
      'Rotate Left did not turn the current page',
    );
    await runMenuCommand(page, 'edit.undo');
    await until(async () => (await rotations()) === '0,0,0', 'Undo did not turn the page back');
    await runMenuCommand(page, 'tools.rotate.right');
    await until(
      async () => /^(1,0,0|0,1,0|0,0,1)$/.test(await rotations()),
      'Tools ▸ Rotate Right did not turn the current page',
    );

    // ⌘S saves every edit into the PDF through the native Save path, including a
    // note still being typed in the annotation menu.
    await page.locator(`.sidebar-annotation[data-annotation-id="${noteId}"]`).click();
    await annotationMenu.waitFor({ state: 'visible' });
    await note.click();
    await note.press('End');
    await page.keyboard.type(' before saving');
    assert.equal(
      await page.evaluate(() => document.activeElement?.classList.contains('annotation-menu-note')),
      true,
    );
    await page.keyboard.press('Control+S');
    await until(
      () => page.evaluate(() => window.chromeSmoke.savedBytes('/smoke/moon.pdf')),
      'Save did not write the Document',
    );
    const saved = Buffer.from(
      await page.evaluate(() => window.chromeSmoke.savedBytes('/smoke/moon.pdf')),
    ).toString('latin1');
    for (const subtype of ['/Highlight', '/Underline', '/Text']) {
      assert.ok(saved.includes(subtype), `The saved PDF lacks its ${subtype} Annotation`);
    }
    assert.match(saved, /\/Rotate 90/, 'The saved PDF lacks its Page Rotation');
    assert.ok(
      holdsPdfText(saved, 'Ask about the moon before saving'),
      'The note typed when ⌘S was pressed was not saved',
    );

    await assertCleanRun(reader);
    console.log(
      'EmbedPDF reader chrome: markup toolbar, Highlight split button, annotation menu, Rotate, menus and Save: PASS',
    );
  } finally {
    await reader.close();
  }
}
