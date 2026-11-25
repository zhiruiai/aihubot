import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, type Page } from 'playwright-core';
import { workspaceViewportFixture } from '../fixtures/browser/workspaceViewportFixture';

async function withinViewport(page: Page, selector: string) {
  const target = page.locator(selector);
  const bounds = await target.boundingBox();
  const viewport = page.viewportSize()!;
  assert.ok(
    bounds &&
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= viewport.width + 1 &&
      bounds.y + bounds.height <= viewport.height + 1,
    `${selector}: ${JSON.stringify(bounds)}`,
  );
}

test(
  'attachments keep chat, input and navigation usable in narrow desktop viewports',
  { timeout: 120_000 },
  async (t) => {
    const browser = await chromium.launch({
      executablePath:
        process.env.CHROME_EXECUTABLE ||
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    t.after(() => browser.close());
    for (const platform of ['Macintosh; Intel Mac OS X 10_15_7', 'Windows NT 10.0; Win64; x64']) {
      // CSS viewport reductions exercise the reflow caused by native page zoom.
      for (const [width, height] of [
        [1280, 800],
        [960, 540],
        [800, 540],
        [640, 360],
        [390, 844],
        [320, 360],
      ]) {
        await t.test(`${platform} ${width}x${height}`, async () => {
          const context = await browser.newContext({
            viewport: { width, height },
            userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/537.36 Chrome/158.0 Safari/537.36`,
          });
          try {
            const page = await context.newPage();
            page.setDefaultTimeout(8000);
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto(await workspaceViewportFixture(page));
            const input = page.locator('.composer textarea');
            const draft = Array.from(
              { length: 12 },
              () => 'Keep these important details in the draft.',
            ).join('\n');
            await input.fill(draft);
            const names = Array.from(
              { length: 8 },
              (_, i) => `quarterly-reconciliation-${i}-${'long-reference-'.repeat(8)}.csv`,
            );
            await page.locator('.composer input[type=file]').setInputFiles(
              names.map((name) => ({
                name,
                mimeType: 'text/csv',
                buffer: Buffer.from('a,b\n1,2'),
              })),
            );
            await page.waitForFunction(
              () => document.querySelectorAll('.composer-attachments button').length === 8,
            );
            for (const selector of ['.chat-header', '.composer-area', '.composer', '.send-button'])
              await withinViewport(page, selector);
            assert.ok(
              await page.locator('.messages-scroll').evaluate((el) => el.clientHeight >= 48),
              'uploaded files leave readable conversation space',
            );
            assert.equal(
              await page
                .locator('.composer-area')
                .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
              false,
            );
            assert.equal(
              await page.locator('html').evaluate((el) => el.scrollWidth > innerWidth + 1),
              false,
            );
            const tray = page.locator('.composer-attachments');
            assert.ok(
              await tray.evaluate((el) => el.scrollHeight > el.clientHeight),
              'only the file list scrolls when many files are attached',
            );
            assert.equal(
              await tray.locator('.attachment-name').first().getAttribute('title'),
              names[0],
            );
            await page.locator('.send-button').click({ trial: true });
            const removeLast = tray.getByRole('button', {
              name: new RegExp(names[7].replaceAll('.', '\\.')),
            });
            await removeLast.click();
            assert.equal(await tray.locator('button').count(), 7);
            assert.equal(await input.inputValue(), draft);
            await withinViewport(page, '.send-button');
            if (width <= 760) {
              await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
              await withinViewport(page, '.mobile-home-header');
              await page.locator('.conversation-row').first().click();
              assert.equal(await input.inputValue(), draft, 'navigation retains the draft');
            } else {
              await page.locator('.chat-title').click();
              await withinViewport(page, '.chat-header');
              await withinViewport(page, '.composer-area');
              await page.locator('.send-button').click({ trial: true });
            }
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        });
      }
    }
  },
);
