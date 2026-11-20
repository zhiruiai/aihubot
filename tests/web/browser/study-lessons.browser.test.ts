import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const origin = 'https://study.example.test';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const api = '/api/workspaces/' + workspaceId;
const root = '/w/' + workspaceId;
const createdAt = '2026-11-17T08:00:00Z';

test('reviewed lessons run inside the study chat with local feedback and optional unsent reflection', async (t) => {
  const bundle = await build({
    stdin: {
      contents: `import './web/src/styles.css'; import './web/src/theme.css';
        import { createRoot } from 'react-dom/client';
        import { initializeLanguage } from './web/src/i18n';
        import { LocalizedRoot } from './web/src/i18n/LocalizedRoot';
        initializeLanguage().setLanguage(new URL(location.href).searchParams.get('lang'));
        createRoot(document.getElementById('root')).render(<LocalizedRoot />);`,
      loader: 'tsx',
      resolveDir: process.cwd(),
    },
    write: false,
    bundle: true,
    outdir: 'fixture-dist',
    jsx: 'automatic',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))!.text;
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined),
  });
  t.after(() => browser.close());
  for (const lang of ['en', 'zh-CN']) {
    await t.test(lang, async () => {
      const page = await browser.newPage({
        viewport: lang === 'zh-CN' ? { width: 320, height: 720 } : { width: 1280, height: 840 },
      });
      try {
        page.setDefaultTimeout(6500);
        const writes: string[] = [];
        const group = (id: string, agentId: string, template?: string) => ({
          id,
          agentIds: [agentId],
          isGroup: true,
          title:
            id === 'study'
              ? 'Our classroom'
              : id === 'disabled'
                ? 'Independent group'
                : '课后探险队',
          unread: 0,
          updatedAt: createdAt,
          teamBrief: {
            goal: 'Practice',
            summary: 'Practice',
            leadAgentId: agentId,
            assignments: [],
            starterTemplateId: template,
          },
        });
        const snapshot = {
          sync: { epoch: 'fixture', revision: 0 },
          agents: ['coach', 'other'].map((id) => ({ id, name: id, role: 'Study', avatar: 'orb' })),
          conversations: [
            group('study', 'coach', 'study'),
            group('legacy', 'coach'),
            group('disabled', 'other', 'study'),
          ],
          messages: [] as unknown[],
          files: [],
          routines: [],
          memories: [],
          apps: [],
          skills: ['coach', 'other'].map((id) => ({
            id,
            agentId: id,
            name: 'pep-math-practice',
            status: id === 'coach' ? 'active' : 'disabled',
            skillPackage: { root: 'pep-math-practice', files: [] },
          })),
          settings: { configured: true, model: 'fixture', language: lang },
          computer: { status: 'disconnected' },
        };
        await page.addInitScript(() => {
          window.EventSource = class extends EventTarget {
            close() {}
          } as unknown as typeof EventSource;
        });
        await page.route(origin + '/**', async (route) => {
          const req = route.request(),
            { pathname } = new URL(req.url());
          if (pathname === root)
            return route.fulfill({
              contentType: 'text/html',
              body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
            });
          if (pathname === '/fixture.js')
            return route.fulfill({ contentType: 'text/javascript', body: js });
          if (pathname === '/api/account/session')
            return route.fulfill({
              json: {
                authenticated: true,
                user: { id: 'learner', name: 'Learner' },
                workspaces: [
                  {
                    id: workspaceId,
                    name: 'School',
                    kind: 'personal',
                    role: 'owner',
                    status: 'active',
                  },
                ],
              },
            });
          if (pathname === api + '/bootstrap') return route.fulfill({ json: snapshot });
          if (req.method() === 'POST') writes.push(pathname);
          return route.fulfill({ status: 404, json: {} });
        });
        const open = (id: string) =>
          page.goto(origin + root + '?conversation=' + id + '&lang=' + lang);
        const choices = page.locator('.starter-prompts button');
        const input = page.locator('.composer textarea');
        for (const id of ['legacy', 'disabled']) {
          await open(id);
          await choices.first().waitFor();
          assert.equal(await choices.count(), 3);
          await choices.first().click();
          assert.equal(await input.inputValue(), await choices.first().innerText());
        }
        await open('study');
        const shelf = page.getByRole('region', {
          name: lang === 'en' ? 'Math practice' : '数学练习',
        });
        const ten = shelf.getByRole('button', { name: lang === 'en' ? /Grade 1/ : /一年级/ });
        const equation = shelf.getByRole('button', { name: lang === 'en' ? /Grade 7/ : /七年级/ });
        const dialog = page.getByRole('dialog');
        const frame = dialog.frameLocator('iframe');
        const reflect = dialog.getByRole('button', {
          name: lang === 'en' ? /Back to chat/ : /回到聊天/,
        });
        await ten.waitFor();
        assert.equal(await choices.count(), 1);
        await choices.first().click();
        assert.match(await input.inputValue(), lang === 'en' ? /this problem/ : /这道题/);
        await input.fill('My earlier explanation');
        await ten.click();
        await frame.getByRole('heading', { name: '还差几颗种子？' }).waitFor();
        await frame.locator('#p2').click();
        await frame.getByText(/看看下面一排/).waitFor();
        await frame.locator('#p3').click();
        for (let count = 0; count < 3; count++) await frame.locator('#plant').click();
        await frame.locator('#nextTray').click();
        await frame.locator('#a4').click();
        assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
        const ownWords = frame.getByLabel(/我知道 6 还差 4/);
        await ownWords.fill('第二排还空四格');
        const handoff = frame.getByRole('button', {
          name: lang === 'en' ? 'Take my answer back to chat' : '带回聊天',
        });
        await handoff.evaluate((node: HTMLElement) => node.click());
        await frame.locator('#save').focus();
        assert.equal(await dialog.isVisible(), true);
        assert.equal(await input.inputValue(), 'My earlier explanation');
        await handoff.click();
        await dialog.waitFor({ state: 'detached' });
        const combined = await input.inputValue();
        assert.ok(combined.startsWith('My earlier explanation\n\n'));
        assert.match(combined, /6/);
        assert.ok(combined.endsWith('第二排还空四格'));
        assert.equal(await input.evaluate((el) => el === document.activeElement), true);
        await input.fill('Keep this draft');
        await equation.click();
        await frame.getByRole('heading', { name: '这一步，错在哪里？' }).waitFor();
        await dialog.locator('.modal-header button').click();
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await input.inputValue(), 'Keep this draft');
        await input.fill('');
        await equation.click();
        await frame.locator('#w1').click();
        await frame.getByText(/右盘原封不动/).waitFor();
        await frame.locator('#w2').click();
        for (let count = 0; count < 3; count++) await frame.locator('#unpack').click();
        for (const id of ['solve', 'both', 'divide', 'verifyNext', 't9'])
          await frame.locator('#' + id).click();
        await frame.getByText(/还需要再做哪一步/).waitFor();
        await frame.locator('#t6').click();
        await frame.getByLabel('我的理由').fill('左右两边做同样的运算。');
        await handoff.click();
        await dialog.waitFor({ state: 'detached' });
        assert.ok((await input.inputValue()).endsWith('左右两边做同样的运算。'));
        assert.match(await input.inputValue(), /2\(y \+ 3\) = 18/);
        assert.doesNotMatch(
          await input.inputValue(),
          /attachmentId|UUID|SKILL\.md|sha256|index\.html/i,
        );
        await input.fill('');
        await ten.click();
        await frame.getByRole('heading', { name: '还差几颗种子？' }).waitFor();
        await reflect.click();
        assert.match(await input.inputValue(), /6/);
        snapshot.messages.push({
          id: 'earlier',
          kind: 'text',
          role: 'user',
          userId: 'learner',
          conversationId: 'study',
          content: 'I have a question',
          createdAt,
        });
        await open('study');
        await ten.waitFor();
        await equation.waitFor();
        assert.equal(await choices.count(), 0);
        assert.deepEqual(writes, []);
      } finally {
        await page.close();
      }
    });
  }
});
