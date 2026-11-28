import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createSharedBrowserEngine } from '../computer-runtime/browser-engine.js';
import { createEgoBrowserSession } from '../computer-runtime/ego-browser.js';
import { createComputerWorker } from '../computer-runtime/http/worker.js';
import { createDesktopAdapter, type DesktopAdapter } from '../computer-runtime/desktop.js';
import { createCuaDesktopAdapter } from '../computer-runtime/cua-desktop.js';
import { createBrowserNetworkProxy } from './network.js';

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const raw = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Missing local execution configuration.')), 5000);
  lines.once('line', (line) => {
    clearTimeout(timer);
    resolve(line);
  });
});
if (raw.length > 16384) throw new Error('Invalid local execution configuration.');
const config = JSON.parse(raw) as {
  workspace: string;
  workspaceId: string;
  publicOrigin?: string;
  hostControl?: boolean;
  desktopDriver?: { kind: 'cua'; executablePath: string; socketPath: string };
  accessibilityHelper?: string | null;
  egoBrowser?: { executablePath: string };
};
if (!isAbsolute(config.workspace) || !/^[a-f0-9-]{36}$/.test(config.workspaceId))
  throw new Error('Invalid local execution configuration.');
if (
  (config.hostControl !== undefined && typeof config.hostControl !== 'boolean') ||
  (config.desktopDriver &&
    (!config.hostControl ||
      config.publicOrigin ||
      config.desktopDriver.kind !== 'cua' ||
      !isAbsolute(config.desktopDriver.executablePath) ||
      !isAbsolute(config.desktopDriver.socketPath)))
)
  throw new Error('Invalid local desktop configuration.');
if (config.hostControl && config.publicOrigin)
  throw new Error('Host control requires personal mode.');
if (
  config.egoBrowser !== undefined &&
  (config.publicOrigin ||
    process.platform !== 'darwin' ||
    typeof config.egoBrowser?.executablePath !== 'string' ||
    !isAbsolute(config.egoBrowser.executablePath))
)
  throw new Error(
    'Ego Lite requires personal mode on macOS and an absolute application executable.',
  );
const helperPath = config.accessibilityHelper;
if (
  helperPath != null &&
  (typeof helperPath !== 'string' ||
    !isAbsolute(helperPath) ||
    config.publicOrigin ||
    process.platform !== 'darwin')
)
  throw new Error('A Mac accessibility helper requires personal mode and an absolute macOS path.');
const accessibilityAdapter =
  helperPath == null
    ? undefined
    : await access(helperPath, constants.X_OK).then(
        () => createDesktopAdapter({ helperPath }),
        () => undefined,
      );
if (config.publicOrigin) process.env.OPENBOT_PUBLIC_ORIGIN = config.publicOrigin;
const token = randomBytes(32).toString('base64url');
const disabledDesktop: DesktopAdapter = {
  async status() {
    return {
      available: false,
      authorized: false,
      enabled: false,
      width: 0,
      height: 0,
      displays: [],
      reason: config.publicOrigin
        ? '平台工作空间不能控制宿主整机桌面。'
        : '当前未开启整机桌面控制。',
      permissions: { screenRecording: 'denied', accessibility: 'denied' },
    };
  },
  async capture() {
    throw new Error('Host desktop is unavailable.');
  },
  async execute() {
    throw new Error('Host desktop is unavailable.');
  },
  setEnabled(enabled) {
    if (enabled) throw new Error('Host desktop is unavailable.');
  },
  async close() {},
};
const egoBrowser = config.egoBrowser && createEgoBrowserSession(config.egoBrowser.executablePath);
const browserEngine = egoBrowser
  ? undefined
  : createSharedBrowserEngine({
      profileDir: resolve(config.workspace, '../browser-profile'),
      createProxy: () => createBrowserNetworkProxy(),
      exclusiveScreen: true,
      keepStartupPageUntilOwned: true,
    });
const worker = createComputerWorker({
  token,
  workspaceDir: config.workspace,
  workspaceScopeId: config.workspaceId,
  browserSession: browserEngine?.screen(config.workspaceId),
  egoBrowser,
  desktopAdapter:
    config.hostControl && config.desktopDriver
      ? createCuaDesktopAdapter(config.desktopDriver)
      : disabledDesktop,
  hostAccessibilityAdapter: accessibilityAdapter,
  hostDesktop: Boolean(config.hostControl && config.desktopDriver),
  hostShell: config.hostControl === true,
});
const server = worker.app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Local executor did not start.');
process.stdout.write(
  JSON.stringify({ ready: true, url: `http://127.0.0.1:${address.port}`, token }) + '\n',
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  let exitCode = 0;
  try {
    await worker.close().finally(() => Promise.all([browserEngine?.close(), egoBrowser?.close()]));
  } catch {
    exitCode = 1;
  } finally {
    server.closeAllConnections();
  }
  process.exit(exitCode);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
process.stdin.once('end', () => void close());
lines.on('line', (line) => {
  if (line === 'close') void close();
});
