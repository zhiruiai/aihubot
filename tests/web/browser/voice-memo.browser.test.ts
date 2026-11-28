import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Message, WorkspaceFile } from '../../../shared/types';
import { encodeSpeechWav, SPEECH_RATE } from '../../../web/src/speechAudio';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const owner = { id: 'memo-fixture', name: 'Fixture Owner', email: 'memo@example.test' };
const bot = { id: 'bot', name: 'Voice Bot', role: 'Assistant', color: '#8b6cca', avatar: 'orb' };
const base = `/api/workspaces/${workspaceId}`;

test(
  'chat records, retries and plays voice messages and Bot memos on demand',
  { timeout: 90_000 },
  async (t) => {
    const bundled = await build({
      stdin: {
        contents: `import './web/src/styles.css'; import './web/src/theme.css';
          import { createRoot } from 'react-dom/client';
          import { initializeLanguage } from './web/src/i18n';
          import { LocalizedRoot } from './web/src/i18n/LocalizedRoot';
          initializeLanguage().setLanguage('en');
          createRoot(document.getElementById('root')).render(<LocalizedRoot />);`,
        resolveDir: process.cwd(),
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      outdir: 'fixture-dist',
      format: 'iife',
      jsx: 'automatic',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
      logLevel: 'silent',
    });
    const js = bundled.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
    const css = bundled.outputFiles.find((file) => file.path.endsWith('.css'))!.text;
    const worklet = readFileSync('web/public/pcm-recorder.worklet.js');
    const server = createServer((request, response) => {
      if (request.url === '/fixture.js')
        return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(js);
      if (request.url === '/pcm-recorder.worklet.js')
        return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(worklet);
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
      server.close();
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    const chrome = process.env.CHROME_EXECUTABLE;
    const args = [
      '--no-proxy-server',
      '--mute-audio',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ];
    const browser = await chromium
      .launch({ headless: true, executablePath: chrome, args })
      .catch((error: Error) => {
        if (
          chrome ||
          process.platform !== 'darwin' ||
          !error.message.includes("Executable doesn't exist")
        )
          throw error;
        return chromium.launch({
          headless: true,
          executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          args,
        });
      });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 740 } });
    page.setDefaultTimeout(10_000);
    await page.addInitScript({
      content: `
        window.EventSource = class extends EventTarget {
          constructor() {
            super();
            setTimeout(() => {
              this.onopen?.();
              this.dispatchEvent(
                new MessageEvent('sync', { data: '{"epoch":"memo","revision":0}' }),
              );
            }, 0);
          }
          close() {}
        };
      `,
    });
    const duration = 8000;
    const bytes = Buffer.from(
      await encodeSpeechWav(new Float32Array((SPEECH_RATE * duration) / 1000)).arrayBuffer(),
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const now = new Date().toISOString();
    const memoFile = (id: string): WorkspaceFile => ({
      id,
      name: `${id}-voice-memo.wav`,
      conversationId: 'chat',
      createdAt: now,
      size: bytes.length,
      type: 'audio/wav',
      sha256,
    });
    const memo = (file: WorkspaceFile, transcript: string): Message => ({
      id: `memo-${file.id}`,
      conversationId: 'chat',
      role: 'assistant',
      agentId: bot.id,
      kind: 'file',
      status: 'done',
      createdAt: now,
      content: transcript,
      metadata: {
        fileId: file.id,
        name: file.name,
        size: file.size,
        sha256,
        voiceMemo: { transcript, durationMs: duration },
      },
    });
    const stored = memoFile('initial');
    const requested = memoFile('requested');
    const snapshot = {
      sync: { epoch: 'memo', revision: 0 },
      agents: [bot],
      conversations: [
        {
          id: 'chat',
          title: bot.name,
          agentIds: [bot.id],
          isGroup: false,
          unread: 0,
          updatedAt: now,
        },
        {
          id: 'group',
          title: 'Fixture Group',
          agentIds: [bot.id],
          isGroup: true,
          unread: 0,
          updatedAt: now,
        },
      ],
      messages: [memo(stored, 'Initial transcript')],
      files: [stored],
      routines: [],
      skills: [],
      memories: [],
      apps: [],
      voiceMemo: { available: true },
      settings: { configured: true, model: 'fixture', language: 'en' },
      computer: { status: 'disconnected' },
      runningConversationIds: [],
      runningRequests: [],
    };
    const posts: {
      clientId: string;
      content: string;
      mode: 'steer' | 'followUp';
      requestVoiceMemo?: true;
    }[] = [];
    const fetched: string[] = [];
    const recordingPosts: string[] = [];
    const recordings = new Map<string, Buffer>();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/account/session')
        return route.fulfill({
          json: {
            authenticated: true,
            user: owner,
            workspaces: [
              {
                id: workspaceId,
                name: 'Fixture Space',
                kind: 'personal',
                role: 'owner',
                status: 'active',
              },
            ],
          },
        });
      if (url.pathname === `${base}/bootstrap`) return route.fulfill({ json: snapshot });
      if (url.pathname === `${base}/files` && request.method() === 'POST') {
        const {
          voiceRecordingId: id,
          conversationId,
          name,
          type,
          content,
        } = request.postDataJSON();
        assert.equal(request.headers()['x-openbot-expected-user'], owner.id);
        assert.equal(conversationId, 'chat');
        assert.equal(name, `recording-${id}.wav`);
        assert.equal(type, 'audio/wav');
        const wave = Buffer.from(content, 'base64');
        assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wave.toString('ascii', 8, 12), 'WAVE');
        const durationMs = Math.floor((wave.length - 44) / 32);
        assert.ok(durationMs >= 250 && durationMs < 60_000);
        recordingPosts.push(id);
        const accepted = recordings.get(id);
        if (accepted) {
          assert.deepEqual(wave, accepted);
          return route.fulfill({
            status: 201,
            json: snapshot.files.find((file) => file.id === id),
          });
        }
        const file = {
          id,
          name,
          type,
          conversationId,
          size: wave.length,
          createdAt: now,
          sha256: createHash('sha256').update(wave).digest('hex'),
        };
        recordings.set(id, wave);
        snapshot.files.push(file);
        snapshot.messages.push({
          id,
          conversationId,
          createdAt: now,
          role: 'user',
          kind: 'file',
          content: name,
          userId: owner.id,
          metadata: {
            fileId: id,
            name,
            size: file.size,
            sha256: file.sha256,
            voiceRecording: { durationMs },
          },
        });
        snapshot.sync.revision++;
        return route.fulfill({ status: 502, json: {} });
      }
      if (url.pathname === `${base}/conversations/chat/messages` && request.method() === 'POST') {
        const body = request.postDataJSON() as (typeof posts)[number];
        posts.push(body);
        const message: Message = {
          id: `input-${posts.length}`,
          conversationId: 'chat',
          role: 'user',
          kind: 'text',
          userId: owner.id,
          content: body.content,
          createdAt: now,
          metadata: body.requestVoiceMemo ? { requestVoiceMemo: true } : undefined,
          delivery: { state: 'delivered', mode: body.mode, clientId: body.clientId },
        };
        snapshot.messages.push(message);
        if (body.requestVoiceMemo) {
          snapshot.files.push(requested);
          snapshot.messages.push(memo(requested, 'Requested transcript'));
        }
        snapshot.sync.revision++;
        return route.fulfill({ json: { message } });
      }
      const file = snapshot.files.find(
        (item) => url.pathname === `${base}/files/${item.id}/download`,
      );
      if (file) {
        assert.equal(request.headers()['x-openbot-expected-user'], owner.id);
        fetched.push(file.id);
        return route.fulfill({
          body: recordings.get(file.id) ?? bytes,
          headers: { 'Content-Type': 'audio/wav', 'Content-Disposition': 'attachment' },
        });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: {} });
      return route.continue();
    });
    await page.goto(`${origin}/w/${workspaceId}?conversation=chat`);
    const toggle = page.getByRole('button', { name: 'Reply with voice memo' });
    const input = page.getByRole('combobox', { name: 'Message content' });
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await input.fill('A voice reply please');
    await input.press('Enter');
    const first = page.locator('#message-memo-initial');
    const second = page.locator('#message-memo-requested');
    await second.getByRole('region', { name: 'Voice memo' }).waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(fetched, []);
    await second.getByText('Show transcript').click();
    await second.getByText('Requested transcript', { exact: true }).waitFor();
    const play = { name: 'Play voice memo' };
    const pause = { name: 'Pause voice memo' };
    await first.getByRole('button', play).click();
    await first.getByRole('button', pause).click();
    const slider = first.getByRole('slider', { name: 'Voice memo playback position' });
    const bounds = await slider.boundingBox();
    assert.ok(bounds);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    assert.ok(
      (await first.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)) > 2,
    );
    await first.getByRole('button', play).click();
    await first.getByRole('button', pause).waitFor();
    await second.getByRole('button', play).click();
    await second.getByRole('button', pause).waitFor();
    await first.getByRole('button', play).waitFor();
    assert.equal(await first.locator('audio').getAttribute('src'), null);
    assert.deepEqual(fetched, ['initial', 'requested']);
    await input.fill('An ordinary text reply');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page
      .locator('#message-input-2')
      .getByText('An ordinary text reply', { exact: true })
      .waitFor();
    assert.equal(posts[0].requestVoiceMemo, true);
    assert.equal(posts[0].mode, 'followUp');
    assert.equal(posts[1].requestVoiceMemo, undefined);
    assert.equal(posts[1].mode, 'steer');

    await input.fill('Keep this unfinished draft');
    const record = page.getByRole('button', { name: 'Record a voice message' });
    const discard = page.getByRole('button', { name: 'Discard recording' });
    await record.click();
    await discard.click();
    await record.click();
    await page.getByText('Recording voice message').waitFor();
    await page.getByText('0:01 / 1:00').waitFor();
    await page.getByRole('button', { name: 'Stop recording' }).click();
    const playRecording = { name: 'Play voice message' };
    const pauseRecording = { name: 'Pause voice message' };
    await page.getByRole('button', playRecording).click();
    await page.getByRole('button', pauseRecording).waitFor();
    assert.deepEqual(recordingPosts, []);
    const sendRecording = page.getByRole('button', { name: 'Send recording' });
    await sendRecording.click();
    await page
      .getByText('Delivery could not be confirmed. Try sending the same recording again.')
      .waitFor();
    await sendRecording.click();
    const recording = page.getByRole('region', { name: 'Voice message' });
    await recording.waitFor();
    assert.equal(recordingPosts.length, 2);
    assert.equal(recordingPosts[0], recordingPosts[1]);
    assert.equal(await input.inputValue(), 'Keep this unfinished draft');
    assert.equal(await recording.count(), 1);
    assert.deepEqual(fetched, ['initial', 'requested']);
    await recording.getByRole('button', playRecording).click();
    await recording.getByRole('button', pauseRecording).waitFor();
    assert.equal(fetched.at(-1), recordingPosts[0]);

    snapshot.files = [stored];
    await page.goto(`${origin}/w/${workspaceId}?conversation=chat`);
    await second.getByText('The audio file is unavailable.').waitFor();
    assert.equal(await second.getByRole('button', play).count(), 0);
    await second.getByText('Show transcript').click();
    await second.getByText('Requested transcript', { exact: true }).waitFor();
    await page.goto(`${origin}/w/${workspaceId}?conversation=group`);
    await input.waitFor();
    assert.equal(await toggle.count(), 0);
    assert.deepEqual(errors, []);
  },
);
