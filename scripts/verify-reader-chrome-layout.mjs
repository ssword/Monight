import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openDocuments, openReaderChrome, runMenuCommand } from './embedpdf-reader-chrome.mjs';

const fixture = new URL(
  '../src-tauri/tests/fixtures/tester-kit/valid-document-a.pdf',
  import.meta.url,
);

const documentPaths = [
  '/smoke/01 長い文書名 – résumé with spaces and a very long filename for the reader toolbar.pdf',
  '/smoke/02 Moon.pdf',
  '/smoke/03 Sun.pdf',
  ...Array.from({ length: 5 }, (_, index) => `/smoke/0${index + 4} Eclipse.pdf`),
];

function inspectToolbar() {
  const title = document.querySelector('#file-name').getBoundingClientRect();
  const page = document.querySelector('#page-status');
  const count = document.createRange();
  count.selectNodeContents(page);
  const zoom = document.querySelector('[aria-label="Zoom"]').getBoundingClientRect();
  const search = document.querySelector('#toolbar-search').getBoundingClientRect();
  const text = count.getBoundingClientRect();
  return {
    titleWidth: title.width,
    pageCount: page.textContent,
    pageCountClear:
      text.right <= zoom.left ||
      text.left >= zoom.right ||
      text.bottom <= zoom.top ||
      text.top >= zoom.bottom,
    searchFits: search.right <= window.innerWidth,
  };
}

export async function verifyReaderChromeLayout(browser, origin) {
  const { page, close } = await openReaderChrome(browser, origin);
  try {
    await page.evaluate(
      ({ paths, bytes }) => {
        document.documentElement.dataset.windowChrome = 'overlay';
        for (const path of paths) window.chromeSmoke.addFile(path, bytes);
      },
      { paths: documentPaths, bytes: [...(await readFile(fixture))] },
    );
    const failures = [];
    const check = (condition, message) => {
      if (!condition) failures.push(message);
    };

    await openDocuments(page, documentPaths.slice(0, 1));
    await page.evaluate(
      (paths) => window.chromeSmoke.chooseFiles(paths),
      documentPaths.slice(1, 3),
    );
    await page.locator('#open-file').click();
    await page.waitForFunction(() => document.querySelectorAll('.tab-item').length === 3);
    await page.getByRole('tab', { name: /長い文書名/ }).click();
    await page.waitForFunction(() =>
      document.querySelector('#file-name').textContent.includes('長い文書名'),
    );
    await page.locator('#sidebar-toggle').click();
    await page.locator('#markup-toolbar-toggle').click();
    for (const width of [735, 565]) {
      await page.setViewportSize({ width, height: 900 });
      const toolbar = await page.evaluate(inspectToolbar);
      assert.equal(toolbar.pageCount, 'Page 1 of 2');
      check(toolbar.titleWidth >= 64, `${width}px: title has only ${toolbar.titleWidth}px`);
      check(toolbar.pageCountClear, `${width}px: page count overlaps the zoom controls`);
      check(toolbar.searchFits, `${width}px: search extends past the window edge`);
    }

    await page.setViewportSize({ width: 1000, height: 900 });
    await page.evaluate((paths) => window.chromeSmoke.chooseFiles(paths), documentPaths.slice(3));
    await page.locator('#open-file').click();
    await page.waitForFunction(() => document.querySelectorAll('.tab-item').length === 8);
    const tabs = page.locator('.tab-item');
    assert.equal(await tabs.count(), documentPaths.length);
    await page.getByRole('tab', { name: /長い文書名/ }).click();
    await page.waitForFunction(() =>
      document.querySelector('[aria-selected="true"]').textContent.includes('長い文書名'),
    );
    await runMenuCommand(page, 'window.previous-tab');
    await page.waitForFunction(() =>
      document.querySelector('[aria-selected="true"]').textContent.includes('08 Eclipse'),
    );
    check(
      await tabs.last().evaluate((item) => {
        const list = item.parentElement.getBoundingClientRect();
        const tab = item.getBoundingClientRect();
        return tab.left >= list.left && tab.right <= list.right + 1;
      }),
      'The newly selected tab is clipped after switching with a Window menu command',
    );
    for (const [index, tab] of (await tabs.all()).entries()) {
      await tab.scrollIntoViewIfNeeded();
      const layout = await tab.evaluate((item) => {
        const list = item.parentElement.getBoundingClientRect();
        const title = item.querySelector('.tab-title').getBoundingClientRect();
        const saveAs = item.querySelector('.tab-save-as').getBoundingClientRect();
        const tab = item.getBoundingClientRect();
        return {
          titleWidth: title.width,
          saveAsFits: saveAs.left >= list.left && saveAs.right <= Math.min(tab.right, list.right),
        };
      });
      check(layout.titleWidth >= 42, `Tab ${index + 1}: label has only ${layout.titleWidth}px`);
      check(layout.saveAsFits, `Tab ${index + 1}: Save As is clipped`);
    }
    assert.deepEqual(failures, []);
    console.log('Reader chrome layout passed at 565px, 735px, and 1000px');
  } finally {
    await close();
  }
}
