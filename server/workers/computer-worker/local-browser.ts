import { mkdir } from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright-core';
import { browserEnvironment } from '../computer-runtime/browser-environment.js';
import { createBrowserNetworkProxy } from './network.js';
import { viewport } from './protocol.js';

export async function launchLocalBrowser(profileDir: string, selectPage: (page: Page) => void) {
  const { chromium } = await import('playwright-core');
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const executablePath = process.env.OPENBOT_BROWSER_EXECUTABLE;
  let proxy: Awaited<ReturnType<typeof createBrowserNetworkProxy>> | undefined;
  let context: BrowserContext | undefined;
  try {
    proxy = await createBrowserNetworkProxy();
    context = await chromium.launchPersistentContext(profileDir, {
      ...(executablePath ? { executablePath } : { channel: 'chrome' }),
      headless: process.env.OPENBOT_BROWSER_HEADLESS !== 'false',
      env: browserEnvironment(profileDir),
      viewport,
      deviceScaleFactor: 1,
      acceptDownloads: false,
      serviceWorkers: 'block',
      timeout: 30_000,
      proxy: { server: proxy.url, bypass: '<-loopback>' },
      args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    });
    await context.route('**/*', (route) => {
      const protocol = new URL(route.request().url()).protocol;
      return ['http:', 'https:'].includes(protocol)
        ? route.continue()
        : route.abort('blockedbyclient');
    });
    context.on('page', selectPage);
    const page = context.pages()[0] ?? (await context.newPage());
    return { page, context, proxy };
  } catch {
    await context?.close().catch(() => {});
    await proxy?.close();
    throw new Error(
      '无法启动独立浏览器。请安装 Chrome，或设置 OPENBOT_BROWSER_EXECUTABLE。OpenBot 不会读取你现有的浏览器登录信息。',
    );
  }
}
