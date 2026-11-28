import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { WORKSPACE_SCOPE_HEADER } from '../../../shared/computer-screens.js';
import { createSharedBrowserEngine } from '../../../server/workers/computer-runtime/browser-engine.js';
import type { BrowserTabList } from '../../../server/workers/computer-runtime/browser-tabs.js';
import { LocalComputer } from '../../../server/workers/computer-worker/local.js';

test(
  'real browser tab operations preserve screen ownership, takeover privacy and retired IDs',
  {
    skip: process.env.OPENBOT_BROWSER_TEST !== '1',
    timeout: 150_000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bamboo-tabs-browser-'));
    const engine = createSharedBrowserEngine({
      profileDir: join(directory, 'profile'),
      // Synthetic about:blank pages need no network access.
      createProxy: async () => ({ url: 'http://127.0.0.1:9', close: async () => {} }),
      headless: true,
      // Allow a slow cold start on test hosts without changing the product's timeout.
      launchPersistentContext: (profile, settings) =>
        chromium.launchPersistentContext(profile, { ...settings, timeout: 90_000 }),
    });
    const a = engine.screen('alpha'),
      b = engine.screen('beta');
    const computer = new LocalComputer(join(directory, 'workspace'), undefined, {
      browserSession: a,
    });
    const list = async () => (await computer.execute({ type: 'browser_tabs' })) as BrowserTabList;
    try {
      assert.deepEqual(await list(), { tabs: [], truncated: false });
      assert.equal(a.peek(), undefined);
      const first = await a.open(),
        second = await b.open();
      await first.page.setContent(
        `<title>First tab</title><button onclick="this.textContent='Continued'">First</button>`,
      );
      await second.page.setContent('<title>Other Bot tab</title>');
      const firstTab = (await list()).tabs[0];
      const foreign = (await b.tabs!.list()).tabs[0];
      for (const type of ['browser_select_tab', 'browser_close_tab'])
        await assert.rejects(computer.execute({ type, tabId: foreign.tabId }), /不属于当前 Bot/);
      const opened = first.page.waitForEvent('popup');
      await first.page.evaluate(() => {
        window.open('about:blank');
      });
      const popup = await opened;
      await popup.setContent('<title>Owned popup</title>');
      const tabs = await list();
      assert.equal(tabs.tabs.length, 2);
      const popupTab = tabs.tabs.find((tab) => tab.title === 'Owned popup')!;
      assert.equal(popupTab.active, true);
      await computer.execute({ type: 'browser_select_tab', tabId: firstTab.tabId });
      assert.ok(a.peek()?.page === first.page);
      assert.ok(b.peek()?.page === second.page);
      const temporaryOpened = popup.waitForEvent('popup');
      await popup.evaluate(() => {
        window.open('about:blank');
      });
      const temporary = await temporaryOpened;
      await temporary.setContent('<title>Temporary tab</title>');
      const temporaryTab = (await list()).tabs.find((tab) => tab.title === 'Temporary tab')!;
      assert.equal(temporaryTab.active, true);
      const remaining = (await computer.execute({
        type: 'browser_close_tab',
        tabId: temporaryTab.tabId,
      })) as BrowserTabList;
      assert.equal(remaining.tabs.find((tab) => tab.active)?.tabId, firstTab.tabId);
      assert.ok(a.peek()?.page === first.page);
      assert.ok(b.peek()?.page === second.page);
      await computer.execute({ type: 'browser_click', selector: 'button' });
      assert.equal(await first.page.locator('button').textContent(), 'Continued');
      const lease = await computer.startTakeover();
      for (const type of ['browser_tabs', 'browser_select_tab', 'browser_close_tab'])
        await assert.rejects(computer.execute({ type, tabId: firstTab.tabId }), /人工接管/);
      await computer.endTakeover(lease.leaseId);
      await assert.rejects(
        computer.execute(
          { type: 'browser_close_tab', tabId: popupTab.tabId },
          { signal: AbortSignal.abort() },
        ),
      );
      assert.equal(popup.isClosed(), false);
      await computer.execute({ type: 'browser_close_tab', tabId: popupTab.tabId });
      assert.equal(popup.isClosed(), true);
      await assert.rejects(
        computer.execute({ type: 'browser_select_tab', tabId: popupTab.tabId }),
        /已关闭/,
      );
      assert.deepEqual(
        await computer.execute({ type: 'browser_close_tab', tabId: firstTab.tabId }),
        { tabs: [], truncated: false },
      );
      assert.equal(a.peek(), undefined);
      assert.equal(second.page.isClosed(), false);
      const replacement = await a.open();
      assert.ok(replacement.page !== first.page);
      await assert.rejects(
        computer.execute({ type: 'browser_select_tab', tabId: firstTab.tabId }),
        /已关闭/,
      );
    } finally {
      await computer.close();
      await engine.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'personal executor resumes its previous tab and retains the workspace browser session after restart',
  { skip: process.env.OPENBOT_BROWSER_TEST !== '1', timeout: 150_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bamboo-personal-tabs-'));
    const fixture = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      switch (request.url) {
        case '/first':
          response.setHeader(
            'Set-Cookie',
            'bamboo_fixture=session; Path=/; Max-Age=3600; HttpOnly',
          );
          response.end(`<title>First</title>
            <a id="second" href="/second" target="_blank">Second</a>
            <a id="temporary" href="/temporary" target="_blank">Temporary</a>
            <a id="export" href="data:text/plain,Fixture%20report" download="report.txt">Export</a>
            <button id="continue" onclick="this.textContent='Continued'">Continue</button>`);
          break;
        case '/second':
          response.end('<title>Second</title>');
          break;
        case '/temporary':
          response.end('<title>Temporary</title>');
          break;
        default:
          response.end(
            request.headers.cookie?.includes('bamboo_fixture=session')
              ? '<title>Saved session</title>'
              : '<title>Missing session</title>',
          );
      }
    }).listen(0, '127.0.0.1');
    const workspace = join(directory, 'workspace');
    const workspaceId = 'bf624797-a5d3-41e0-9c54-a8fbc60e7042';
    const entry = fileURLToPath(
      new URL('../../../server/workers/computer-worker/local-entry.ts', import.meta.url),
    );
    let stop: (() => Promise<void>) | undefined;
    try {
      await once(fixture, 'listening');
      const origin = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;

      async function start() {
        const child = spawn(process.execPath, ['--import', 'tsx', entry], {
          stdio: ['pipe', 'pipe', 'inherit'],
          env: {
            ...process.env,
            OPENBOT_BROWSER_ALLOWED_ORIGINS: origin,
            OPENBOT_BROWSER_HEADLESS: 'true',
          },
        });
        const exited = once(child, 'exit');
        const lines = createInterface({ input: child.stdout });
        child.stdin.on('error', () => {});
        stop = async () => {
          child.stdin.end('close\n');
          const force = setTimeout(() => child.kill('SIGKILL'), 8_000);
          try {
            const [code] = await exited;
            assert.equal(code, 0);
          } finally {
            clearTimeout(force);
            lines.close();
          }
        };
        child.stdin.write(JSON.stringify({ workspace, workspaceId }) + '\n');
        const line = await Promise.race([
          once(lines, 'line').then(([value]) => String(value)),
          exited.then(() => {
            throw new Error('Personal computer executor did not start');
          }),
        ]);
        const { url, token } = JSON.parse(line);
        const auth = { Authorization: `Bearer ${token}` };
        const health = await (await fetch(`${url}/health`, { headers: auth })).json();
        assert.ok(health.capabilities.includes('browser-tabs-v1'));
        const headers = {
          ...auth,
          'Content-Type': 'application/json',
          'X-OpenBot-Worker-Instance': health.instanceId,
          'X-OpenBot-Control-Origin': health.controlOrigin ?? 'none',
          [WORKSPACE_SCOPE_HEADER]: workspaceId,
        };
        return async (action: unknown) => {
          const response = await fetch(`${url}/execute`, {
            method: 'POST',
            headers,
            body: JSON.stringify(action),
          });
          const result = await response.json();
          assert.equal(response.status, 200, JSON.stringify(result));
          return result;
        };
      }

      const execute = await start();
      const list = async () => (await execute({ type: 'browser_tabs' })) as BrowserTabList;
      const waitForTab = async (path: string) => {
        for (let attempt = 0; attempt < 30; attempt++) {
          const tab = (await list()).tabs.find((entry) => entry.url === `${origin}${path}`);
          if (tab) return tab;
          await delay(100);
        }
        assert.fail(`Browser tab did not open ${path}`);
      };
      assert.deepEqual(await list(), { tabs: [], truncated: false });
      await execute({ type: 'browser_navigate', url: `${origin}/first` });
      const first = await waitForTab('/first');
      await execute({ type: 'browser_click', selector: '#second' });
      await waitForTab('/second');
      await execute({ type: 'browser_select_tab', tabId: first.tabId });
      await execute({ type: 'browser_click', selector: '#temporary' });
      const temporary = await waitForTab('/temporary');
      assert.ok(temporary.active);
      const remaining = (await execute({
        type: 'browser_close_tab',
        tabId: temporary.tabId,
      })) as BrowserTabList;
      assert.equal(remaining.tabs.find((tab) => tab.active)?.tabId, first.tabId);
      const continued = await execute({ type: 'browser_click', selector: '#continue' });
      assert.match(continued.text, /Continued/);
      await execute({ type: 'browser_download', selector: '#export', path: 'report.txt' });
      assert.equal(await readFile(join(workspace, 'report.txt'), 'utf8'), 'Fixture report');

      await stop?.();
      stop = undefined;
      const restarted = await start();
      assert.deepEqual(await restarted({ type: 'browser_tabs' }), { tabs: [], truncated: false });
      const restored = await restarted({ type: 'browser_navigate', url: `${origin}/session` });
      assert.equal(restored.title, 'Saved session');
    } finally {
      try {
        await stop?.();
      } finally {
        await new Promise<void>((resolve) => fixture.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);
