import assert from 'node:assert/strict';
import { webkit } from 'playwright';

const names = [
  'Maximize on Open',
  'Remember Last Filter',
  'Restore Previous Session',
  'Continuous Scroll by Default',
];

const browser = await webkit.launch();
try {
  const page = await browser.newPage();
  // The checkbox semantics are defined in the markup. No Tauri store is needed.
  await page.goto(new URL('../settings.html', import.meta.url).href);

  const general = page.locator('#panel-general');
  const checkboxes = general.getByRole('checkbox');
  assert.equal(await checkboxes.count(), names.length);
  for (const name of names) {
    const checkbox = general.getByRole('checkbox', { name, exact: true });
    assert.equal(await checkbox.count(), 1, await general.ariaSnapshot());

    const checked = await checkbox.isChecked();
    await checkbox.focus();
    await page.keyboard.press('Space');
    assert.equal(
      await general.getByRole('checkbox', { name, exact: true, checked: !checked }).count(),
      1,
      `${name} should expose its updated checked state`,
    );
  }
  console.log('All four General Settings checkboxes expose their names and checked state.');
} finally {
  await browser.close();
}
