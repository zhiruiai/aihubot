import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright-core';

const origin = 'https://viewport.example.test';
const workspaceId = '11111111-1111-4111-8111-111111111111';
let bundle: Promise<{ script: string; style: string }> | undefined;

export async function workspaceViewportFixture(page: Page) {
  bundle ??= build({
    stdin: {
      contents: `
        import './web/src/styles.css'; import './web/src/theme.css';
        import {createRoot} from 'react-dom/client';
        import {initializeLanguage} from './web/src/i18n';
        import {LocalizedRoot} from './web/src/i18n/LocalizedRoot';
        initializeLanguage().setLanguage('en');
        createRoot(document.getElementById('root')).render(<LocalizedRoot/>);
      `,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outdir: 'fixture',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    logLevel: 'silent',
  }).then(({ outputFiles }) => ({
    script: outputFiles.find((file) => file.path.endsWith('.js'))!.text,
    style: outputFiles.find((file) => file.path.endsWith('.css'))!.text,
  }));
  const { script, style } = await bundle;
  const bot = {
    id: 'reviewer',
    name: 'International research and engineering team',
    role: 'Research',
    avatar: 'orb',
    color: '#248acc',
  };
  const timestamp = '2026-11-25T10:00:00Z';
  const snapshot = {
    sync: { epoch: 'fixture', revision: 0 },
    agents: [bot],
    conversations: Array.from({ length: 24 }, (_, i) => ({
      id: 'chat-' + i,
      title: bot.name + ' ' + i,
      agentIds: [bot.id],
      isGroup: false,
      unread: 0,
      updatedAt: timestamp,
    })),
    messages: Array.from({ length: 30 }, (_, i) => ({
      id: 'message-' + i,
      conversationId: 'chat-0',
      agentId: bot.id,
      role: 'assistant',
      kind: 'text',
      status: 'done',
      createdAt: timestamp,
      content: 'Review the source and preserve useful evidence.\n\nA practical, verifiable result.',
    })),
    routines: [],
    files: [],
    skills: [],
    memories: [],
    apps: [],
    settings: { configured: true, model: 'fixture', language: 'en' },
    computer: { status: 'disconnected' },
    runningConversationIds: [],
    runningRequests: [],
  };
  await page.addInitScript((sync) => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.dataset.openbotDesktop = 'true';
    });
    window.EventSource = class extends EventTarget {
      onopen?: () => void;
      constructor() {
        super();
        setTimeout(() => {
          this.onopen?.();
          this.dispatchEvent(new MessageEvent('sync', { data: JSON.stringify(sync) }));
        }, 0);
      }
      close() {}
    } as unknown as typeof EventSource;
  }, snapshot.sync);
  let fileIndex = 0;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/fixture.js')
      return route.fulfill({ contentType: 'text/javascript', body: script });
    if (url.pathname === '/favicon.svg')
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: await readFile('web/public/favicon.svg'),
      });
    if (url.pathname === '/api/account/session')
      return route.fulfill({
        json: {
          authenticated: true,
          user: { id: 'owner', name: 'Test Owner', email: 'owner@example.test' },
          workspaces: [
            {
              id: workspaceId,
              name: 'Research and engineering workspace with a long title',
              kind: 'personal',
              role: 'owner',
              status: 'active',
            },
          ],
        },
      });
    if (url.pathname.endsWith('/files') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: {
          id: 'file-' + fileIndex++,
          name: body.name,
          type: body.type,
          size: 8,
          createdAt: timestamp,
        },
      });
    }
    if (url.pathname.endsWith('/bootstrap')) return route.fulfill({ json: snapshot });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>${style}</style><div id="root"></div><script src="/fixture.js"></script>`,
    });
  });
  return origin + '/w/' + workspaceId + '?conversation=chat-0';
}
