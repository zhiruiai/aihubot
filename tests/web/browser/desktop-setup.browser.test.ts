import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const setupAsset = require('../../../desktop/session-policy.cjs').createSetupProtocolHandler() as (
  request: Pick<Request, 'url' | 'method'>,
) => Promise<Response>;

test(
  'desktop setup presents the available local action before supplementary help at narrow sizes',
  { timeout: 60_000 },
  async (t) => {
    const browser = await chromium.launch({
      executablePath:
        process.env.CHROME_EXECUTABLE ||
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    t.after(() => browser.close());
    for (const language of ['en', 'zh-CN']) {
      for (const [width, height] of [
        [1280, 800],
        [960, 720],
        [760, 500],
        [640, 360],
        [440, 300],
        [320, 360],
      ]) {
        const page = await browser.newPage({ viewport: { width, height } });
        try {
          await page.addInitScript({
            content: `
            const state = {status:'setup',language:${JSON.stringify(language)},
              localAvailable:true,localHostControlAvailable:true};
            window.openbotDesktop = {getState:async()=>state,onState:()=>()=>{},
              startLocal:async()=>state,connect:async()=>state};
          `,
          });
          await page.route('https://setup.example.test/**', async (route) => {
            const { pathname, search } = new URL(route.request().url());
            const response = await setupAsset({
              url: `openbot-app://setup${pathname}${search}`,
              method: route.request().method(),
            });
            assert.equal(response.status, 200);
            return route.fulfill({
              headers: Object.fromEntries(response.headers),
              body: Buffer.from(await response.arrayBuffer()),
            });
          });
          await page.goto('https://setup.example.test/');
          const fontLoaded = await page.evaluate(async () => {
            const font = await document.fonts.load(
              '400 14px "Alimama FangYuanTi VF"',
              '工作空间 aihubot',
            );
            return font.some((face) => face.status === 'loaded');
          });
          assert.equal(fontLoaded, true, 'the setup page loads its bundled font under CSP');
          await page.waitForFunction(() => document.activeElement?.id === 'start-local');
          const first = page.locator('#start-local');
          const bounds = await first.boundingBox();
          assert.ok(
            bounds && bounds.y >= 0 && bounds.y + bounds.height <= height + 1,
            `${language} ${width}x${height}: local action is visible`,
          );
          assert.equal(
            await page.locator('html').evaluate((el) => el.scrollWidth > innerWidth + 1),
            false,
          );
          await first.click({ trial: true });
          if (width < 760) {
            const actions = await page.locator('.setup-actions').boundingBox();
            const help = await page.locator('.workspace-note').boundingBox();
            assert.ok(
              actions && help && actions.y + actions.height <= help.y + 1,
              'both connection choices precede extra help',
            );
          }
          await page.locator('#workspace-url').fill('https://workspace.example.test');
          await page.locator('#connect-button').click({ trial: true });
          await page.locator('#client-language').scrollIntoViewIfNeeded();
          assert.equal(
            await page.locator('#workspace-url').inputValue(),
            'https://workspace.example.test',
          );
        } finally {
          await page.close();
        }
      }
    }
  },
);
