import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, type Locator } from 'playwright-core';

async function checkFooter(dialog: Locator, height: number) {
  const geometry = await dialog.evaluate((modal) => {
    const footer = modal.querySelector<HTMLElement>('.modal-footer')!;
    const body = modal.querySelector<HTMLElement>('.modal-body')!;
    const button = footer.querySelector<HTMLButtonElement>('[type=submit]')!;
    const rect = button.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      top: rect.top,
      hit: button.contains(
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
      ),
      outerOverflow: modal.scrollHeight - modal.clientHeight,
      horizontalOverflow: modal.scrollWidth - modal.clientWidth,
      bodyHeight: body.clientHeight,
      scrolls: [...modal.querySelectorAll<HTMLElement>('*')]
        .filter(
          (element) =>
            ['auto', 'scroll'].includes(getComputedStyle(element).overflowY) &&
            element.scrollHeight > element.clientHeight + 1,
        )
        .map((element) => element.className),
    };
  });
  assert.ok(
    geometry.top >= 0 && geometry.bottom <= height && geometry.hit,
    JSON.stringify(geometry),
  );
  assert.ok(
    geometry.outerOverflow <= 1 && geometry.horizontalOverflow <= 1,
    JSON.stringify(geometry),
  );
  assert.ok(geometry.bodyHeight >= 44, JSON.stringify(geometry));
  assert.ok(
    geometry.scrolls.length <= 1 &&
      geometry.scrolls.every((className) => className === 'modal-body'),
    JSON.stringify(geometry),
  );
}

test(
  'Bot and group creation keep submission reachable and group membership searchable after creation',
  { timeout: 90_000 },
  async () => {
    const origin = 'https://creation-layout.example.test';
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';
    const base = `/api/workspaces/${workspaceId}`;
    const bundle = await build({
      stdin: {
        loader: 'tsx',
        resolveDir: process.cwd(),
        contents: `
        import './web/src/styles.css'; import './web/src/theme.css';
        import { useState } from 'react'; import { createRoot } from 'react-dom/client';
        import { CreateDialog } from './web/src/components/CreateDialog';
        import { GroupSettingsDialog } from './web/src/components/GroupSettingsDialog';
        import { initializeLanguage } from './web/src/i18n';
        initializeLanguage().setLanguage('en');
        const agents = Array.from({length:24}, (_, i) => ({id:'bot-'+i, name:'Synthetic Bot '+i,
          role:i === 23 ? 'Quality reviewer' : 'Researcher', description:'', instructions:'',
          avatar:'orb', color:'#556677', status:'idle'}));
        function Fixture() {
          const [group, setGroup] = useState();
          const [saved, setSaved] = useState(false);
          const [openedBot, setOpenedBot] = useState('');
          return openedBot ? <output>{openedBot}</output> : group ? <>
            <GroupSettingsDialog conversation={group} agents={agents}
              workspaceId="${workspaceId}" userId="${userId}" onClose={() => {}}
              onSaved={chat => { setGroup(chat); setSaved(true); }} />
            {saved && <output>Saved group settings</output>}
          </> : <CreateDialog agents={agents} canCreateBot workspaceId="${workspaceId}"
            userId="${userId}" onClose={() => {}} onTeamCreated={() => {}}
            onCreated={chat => chat.isGroup ? setGroup(chat) : setOpenedBot(chat.title)} />;
        }
        createRoot(document.getElementById('fixture')).render(<Fixture />);
      `,
      },
      bundle: true,
      write: false,
      outdir: 'fixture-dist',
      format: 'iife',
      jsx: 'automatic',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    const script = bundle.outputFiles.find(({ path }) => path.endsWith('.js'))!.text;
    const style = bundle.outputFiles.find(({ path }) => path.endsWith('.css'))!.text;
    const browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROME_EXECUTABLE ||
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });
    const writes: Array<{ path: string; body: Record<string, any> }> = [];
    let receipt: Record<string, any>;
    let conversation: Record<string, any>;
    let revision = 'a'.repeat(64);
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        assert.equal(url.origin, origin);
        if (request.isNavigationRequest())
          return route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>${style}</style><div id="fixture"></div><script src="/fixture.js"></script>`,
          });
        if (url.pathname === '/fixture.js')
          return route.fulfill({ contentType: 'text/javascript', body: script });
        if (url.pathname === `${base}/model-profiles`)
          return route.fulfill({ json: { profiles: [] } });
        if (url.pathname.startsWith(`${base}/creation-requests`)) {
          if (request.method() === 'POST') {
            const body = request.postDataJSON();
            writes.push({ path: url.pathname, body });
            const agentIds = body.kind === 'group' ? body.agentIds : ['created-bot'];
            conversation = {
              id: 'synthetic-group',
              title: body.kind === 'group' ? body.title : body.profile.name,
              agentIds,
              isGroup: body.kind === 'group',
              updatedAt: '2026-11-25T00:00:00Z',
              unread: 0,
              pinned: false,
            };
            receipt = {
              requestId: body.requestId,
              kind: body.kind,
              status: 'created',
              conversationId: conversation.id,
              agentIds,
              conversation,
              agents: agentIds.map((id: string) => ({
                id,
                name: 'Synthetic Bot ' + id.slice(4),
                role: 'Researcher',
                description: '',
                instructions: '',
                avatar: 'orb',
                color: '#556677',
                status: 'idle',
                ...(body.kind === 'bot' ? body.profile : {}),
              })),
              createdAt: conversation.updatedAt,
              workspaceId,
              userId,
            };
          }
          return route.fulfill({ json: receipt });
        }
        assert.equal(url.pathname, `${base}/conversations/synthetic-group/settings`);
        if (request.method() === 'PATCH') {
          const body = request.postDataJSON();
          writes.push({ path: url.pathname, body });
          assert.equal(body.expectedRevision, revision);
          conversation = { ...conversation, ...body };
          revision = 'b'.repeat(64);
        }
        return route.fulfill({ json: { conversation, revision } });
      });
      for (const viewport of [
        { width: 1200, height: 800 },
        { width: 568, height: 320 },
        { width: 320, height: 330 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`${origin}/w/${workspaceId}`);
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Start from a template' }).waitFor();
        await checkFooter(dialog, viewport.height);
        if (process.env.BAMBOOSHIFT_CAPTURE_UI === '1')
          await page.screenshot({
            path: `.local/create-bot-${viewport.width}-${viewport.height}.png`,
            animations: 'disabled',
          });
        await dialog.getByRole('tab', { name: 'Manual group chat' }).click();
        const search = dialog.getByRole('searchbox');
        await search.fill('Quality');
        const reviewer = dialog.getByRole('checkbox', { name: /Synthetic Bot 23/ });
        await reviewer.check();
        await search.fill('Bot 0');
        await dialog.getByRole('checkbox', { name: /Synthetic Bot 0$/ }).check();
        assert.equal(await dialog.locator('.group-recipient-tag').count(), 2);
        await search.fill('');
        assert.equal(await dialog.getByRole('checkbox').count(), 24);
        await checkFooter(dialog, viewport.height);
        if (process.env.BAMBOOSHIFT_CAPTURE_UI === '1')
          await page.screenshot({
            path: `.local/create-group-${viewport.width}-${viewport.height}.png`,
            animations: 'disabled',
          });
        const footer = dialog.locator('.modal-footer');
        const anchored = await footer.boundingBox();
        await dialog.locator('.modal-body').evaluate((body) => {
          body.scrollTop = body.scrollHeight;
        });
        assert.deepEqual(await footer.boundingBox(), anchored);
        if (viewport.width !== 320) continue;
        const before = writes.length;
        await footer.locator('[type=submit]').click();
        await dialog.getByRole('button', { name: 'Open conversation', exact: true }).click();
        await dialog.locator('.group-member-search').waitFor();
        assert.equal(writes.length, before + 1);
        assert.deepEqual(writes.at(-1)!.body.agentIds, ['bot-23', 'bot-0']);
        await dialog.getByRole('searchbox').fill('Bot 0');
        await dialog.getByRole('checkbox', { name: /Synthetic Bot 0$/ }).uncheck();
        await dialog.getByRole('searchbox').fill('Bot 5');
        await dialog.getByRole('checkbox', { name: /Synthetic Bot 5$/ }).check();
        assert.match(
          await dialog.locator('.group-member-selected').innerText(),
          /Synthetic Bot 23/,
        );
        assert.match(await dialog.locator('.group-member-selected').innerText(), /Synthetic Bot 5/);
        await dialog.getByRole('searchbox').fill('');
        await checkFooter(dialog, viewport.height);
        if (process.env.BAMBOOSHIFT_CAPTURE_UI === '1')
          await page.screenshot({
            path: '.local/group-settings-320-330.png',
            animations: 'disabled',
          });
        await dialog.locator('.modal-footer [type=submit]').click();
        await page
          .getByText('Saved group settings', { exact: true })
          .waitFor({ state: 'attached' });
        assert.deepEqual(writes.at(-1)!.body.agentIds, ['bot-23', 'bot-5']);
      }
      await page.goto(`${origin}/w/${workspaceId}`);
      const botDialog = page.getByRole('dialog');
      await botDialog.locator('.modal-footer [type=submit]').click();
      assert.equal(
        await botDialog
          .getByLabel('Bot name', { exact: true })
          .evaluate((input) => input === document.activeElement),
        true,
      );
      await botDialog.getByLabel('Bot name', { exact: true }).fill('Synthetic created Bot');
      await botDialog.getByLabel('Work role', { exact: true }).fill('Researcher');
      await botDialog
        .getByLabel('Persistent instructions', { exact: true })
        .fill('Verify the selected sources.');
      const beforeBot = writes.length;
      await botDialog.locator('.modal-footer [type=submit]').click();
      await botDialog.getByRole('button', { name: 'Open conversation', exact: true }).click();
      await page.getByText('Synthetic created Bot', { exact: true }).waitFor();
      assert.equal(writes.length, beforeBot + 1);
      assert.equal(writes.at(-1)!.body.kind, 'bot');
      assert.equal(writes.at(-1)!.body.profile.instructions, 'Verify the selected sources.');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
