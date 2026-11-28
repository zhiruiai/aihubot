import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  EGO_BROWSER_CAPABILITY,
  WORKSPACE_SCOPE_HEADER,
} from '../../../shared/computer-screens.js';
import type { BrowserTabList } from '../../../server/workers/computer-runtime/browser-tabs.js';

test(
  'real personal worker uses Ego tabs and resumes them after native takeover',
  {
    skip: !process.env.AIHUBOT_EGO_TEST_EXECUTABLE || process.platform !== 'darwin',
    timeout: 150_000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aihubot-ego-worker-'));
    const runtimeTemp = join(directory, 'runtime');
    await mkdir(runtimeTemp, { mode: 0o700 });
    let privateHits = 0;
    const privateServer = createServer((_request, response) => {
      privateHits++;
      response.end('Private control fixture');
    }).listen(0, '127.0.0.1');
    await once(privateServer, 'listening');
    const privateOrigin = `http://127.0.0.1:${(privateServer.address() as AddressInfo).port}`;
    const fixtures = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      switch (request.url) {
        case '/one':
          response.end(`<title>Order workspace</title>
            <a href="/two" id="second" target="_blank">Reference</a>
            <a href="/temporary" id="temporary" target="_blank">Temporary detail</a>
            <a href="/blocked" id="redirect" target="_blank">External redirect</a>
            <button id="continue" onclick="this.textContent='Order continued'">Continue</button>`);
          break;
        case '/two':
          response.end('<title>Reference document</title>');
          break;
        case '/temporary':
          response.end('<title>Temporary detail</title>');
          break;
        case '/blocked':
          response.writeHead(302, { Location: privateOrigin }).end();
          break;
        default:
          response.writeHead(404).end();
      }
    }).listen(0, '127.0.0.1');
    await once(fixtures, 'listening');
    const origin = `http://127.0.0.1:${(fixtures.address() as AddressInfo).port}`;
    const workspaceId = 'f0427f75-6f0b-4728-9107-a5174b7d3d69';
    const entry = fileURLToPath(
      new URL('../../../server/workers/computer-worker/local-entry.ts', import.meta.url),
    );
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, TMPDIR: runtimeTemp, OPENBOT_BROWSER_ALLOWED_ORIGINS: origin },
    });
    const exited = once(child, 'exit');
    const lines = createInterface({ input: child.stdout });
    child.stdin.on('error', () => {});
    try {
      child.stdin.write(
        JSON.stringify({
          workspace: join(directory, 'workspace'),
          workspaceId,
          egoBrowser: { executablePath: process.env.AIHUBOT_EGO_TEST_EXECUTABLE },
        }) + '\n',
      );
      const line = await Promise.race([
        once(lines, 'line').then(([value]) => String(value)),
        exited.then(() => assert.fail('The Ego worker exited during setup')),
      ]);
      const { url, token } = JSON.parse(line);
      const auth = { Authorization: `Bearer ${token}` };
      const health = await (await fetch(`${url}/health`, { headers: auth })).json();
      assert.ok(health.capabilities.includes(EGO_BROWSER_CAPABILITY));
      const headers = {
        ...auth,
        'Content-Type': 'application/json',
        'X-OpenBot-Worker-Instance': health.instanceId,
        'X-OpenBot-Control-Origin': health.controlOrigin ?? 'none',
        [WORKSPACE_SCOPE_HEADER]: workspaceId,
      };
      const post = async <T>(path: string, body: unknown, expected = 200): Promise<T> => {
        const response = await fetch(`${url}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        const result = await response.json();
        assert.equal(response.status, expected, JSON.stringify(result));
        return result as T;
      };
      const execute = <T>(action: unknown, expected?: number) =>
        post<T>('/execute', action, expected);
      const list = () => execute<BrowserTabList>({ type: 'browser_tabs' });
      const waitForTab = async (path: string) => {
        for (let attempt = 0; attempt < 20; attempt++) {
          const tab = (await list()).tabs.find((entry) => entry.url === `${origin}${path}`);
          if (tab) return tab;
          await delay(100);
        }
        assert.fail(`Browser tab did not open ${path}`);
      };
      assert.deepEqual(await list(), { tabs: [], truncated: false });
      const opened = await execute<{ title: string }>({
        type: 'browser_navigate',
        url: `${origin}/one`,
      });
      assert.equal(opened.title, 'Order workspace');
      const first = await waitForTab('/one');
      await execute({ type: 'browser_click', selector: '#second' });
      const second = await waitForTab('/two');
      await execute({ type: 'browser_select_tab', tabId: first.tabId });
      await execute({ type: 'browser_click', selector: '#temporary' });
      const temporary = await waitForTab('/temporary');
      await execute({ type: 'browser_select_tab', tabId: temporary.tabId });
      const remaining = await execute<BrowserTabList>({
        type: 'browser_close_tab',
        tabId: temporary.tabId,
      });
      assert.deepEqual(
        remaining.tabs.map((tab) => tab.tabId),
        [first.tabId, second.tabId],
      );
      assert.equal(remaining.tabs[0].active, true);
      const retired = await execute<{ error: string }>(
        { type: 'browser_select_tab', tabId: temporary.tabId },
        400,
      );
      assert.match(retired.error, /已关闭/);

      const screenshot = await fetch(`${url}/screenshot`, { headers });
      assert.equal(screenshot.status, 200);
      assert.equal(
        Buffer.from(await screenshot.arrayBuffer())
          .subarray(1, 4)
          .toString(),
        'PNG',
      );
      const lease = await post<{ leaseId: string }>('/takeover/start', {});
      assert.ok(lease.leaseId);
      const denied = await execute<{ error: string }>({ type: 'browser_tabs' }, 400);
      assert.match(denied.error, /人工接管/);
      const hidden = await fetch(`${url}/screenshot`, {
        headers: { ...headers, 'X-OpenBot-Computer-Lease': lease.leaseId },
      });
      assert.equal(hidden.status, 503);
      assert.match((await hidden.json()).error, /Ego Lite/);
      await post('/takeover/end', { leaseId: lease.leaseId });
      const continued = await execute<{ text: string }>({
        type: 'browser_click',
        selector: '#continue',
      });
      assert.match(continued.text, /Order continued/);
      assert.deepEqual(
        (await list()).tabs.map((tab) => tab.tabId),
        [first.tabId, second.tabId],
      );

      await execute({ type: 'browser_click', selector: '#redirect' });
      await delay(1200);
      assert.equal(privateHits, 0, 'Ego must send redirect targets through the network policy');
    } finally {
      child.stdin.end('close\n');
      const force = setTimeout(() => child.kill('SIGKILL'), 12_000);
      try {
        const [code] = await exited;
        assert.equal(code, 0);
        assert.ok(
          !(await readdir(runtimeTemp)).some((name) => name.startsWith('aihubot-ego-browser-')),
        );
      } finally {
        clearTimeout(force);
        lines.close();
        fixtures.closeAllConnections();
        privateServer.closeAllConnections();
        await Promise.all([
          new Promise<void>((resolve) => fixtures.close(() => resolve())),
          new Promise<void>((resolve) => privateServer.close(() => resolve())),
        ]);
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);
