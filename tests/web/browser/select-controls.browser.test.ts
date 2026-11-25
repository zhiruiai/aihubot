import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('native dropdowns contain long lists without trapping the dialog keyboard', async (t) => {
  const bundle = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { Dialog } from './web/src/components/UI';
        import './web/src/base.css';
        import './web/src/theme.css';

        function Fixture() {
          const [open, setOpen] = useState(true);
          return open ? <Dialog title="Settings" onClose={() => setOpen(false)}>
            <div className="dialog-form">
              <label>Short list<select defaultValue="first">
                <option value="first">First</option><option value="second">Second</option>
              </select></label>
              <label>Long list<select defaultValue="1">
                {Array.from({length: 24}, (_, index) => <option key={index} value={index + 1}>
                  {index === 23 ? 'A long selection ' + 'xxxxxxxx'.repeat(16) : 'Option ' + (index + 1)}
                </option>)}
              </select></label>
              <section id="preview" tabIndex={-1}><button>Use template</button></section>
            </div>
          </Dialog> : <p>Dialog closed</p>;
        }
        createRoot(document.getElementById('root')).render(<Fixture />);
      `,
      loader: 'tsx',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    outfile: 'select-fixture.js',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 430 } });
  await page.setContent(
    '<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div>',
  );
  await page.addStyleTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.css'))!.text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });

  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const short = dialog.getByRole('combobox', { name: 'Short list' });
  await short.click();
  assert.equal(await short.evaluate((el) => getComputedStyle(el).appearance), 'base-select');
  const pickerHeight = (el: Element) => parseFloat(getComputedStyle(el, '::picker(select)').height);
  assert.ok((await short.evaluate(pickerHeight)) < 100);
  await page.keyboard.press('Escape');
  assert.equal(await short.evaluate((el) => el.matches(':open')), false);
  assert.equal(await dialog.isVisible(), true);

  const long = dialog.getByRole('combobox', { name: 'Long list' });
  await long.click();
  const tall = await long.evaluate(pickerHeight);
  assert.ok(tall > 140 && tall <= 190, `Unexpected popup height ${tall}`);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.equal(await long.inputValue(), '24');
  assert.equal(await long.evaluate((el) => el.matches(':open')), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
  await dialog.locator('#preview').focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Use template' })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
});
