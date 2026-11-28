import { randomUUID } from 'node:crypto';
import { resolveBrowserTarget } from '../computer-worker/network.js';
import { pngDimensions, type ComputerActionInput } from '../computer-worker/protocol.js';
import type { BrowserTabList, BrowserTabOptions } from './browser-tabs.js';
import { EgoSdkError, startEgoRuntime, type EgoOperation, type EgoRuntime } from './ego-runtime.js';

export interface EgoBrowserSession {
  isOpen(): boolean;
  execute(action: ComputerActionInput, options: BrowserTabOptions): Promise<unknown>;
  screenshot(options: BrowserTabOptions): Promise<Buffer>;
  handOff(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

type NativeTab = { targetId: string; title: string; url: string; active: boolean };
type TabEntry = { id: string; order: number };
const emptyTabs: BrowserTabList = { tabs: [], truncated: false };
const pageActions: Partial<Record<ComputerActionInput['type'], EgoOperation>> = {
  browser_click: 'click',
  browser_type: 'fill',
  browser_scroll: 'scroll',
  browser_back: 'back',
};
const unavailable = () =>
  new Error('无法启动隔离的 Ego Lite 浏览器。请检查已安装版本和浏览器设置。');
const retiredTab = () => new Error('标签页已关闭或不属于当前工作区，请重新查看标签页列表。');
const userInControl = () => new Error('用户正在 Ego Lite 中接管浏览器。请结束接管后再继续。');

function check(options: BrowserTabOptions) {
  options.signal?.throwIfAborted();
  options.authorize?.();
}

function nativeTabs(value: unknown): NativeTab[] {
  if (!Array.isArray(value) || value.length > 256) throw unavailable();
  return value.map((tab: Partial<NativeTab>) => {
    if (
      !tab ||
      typeof tab.targetId !== 'string' ||
      !tab.targetId ||
      tab.targetId.length > 160 ||
      typeof tab.title !== 'string' ||
      typeof tab.url !== 'string' ||
      typeof tab.active !== 'boolean'
    )
      throw unavailable();
    return { targetId: tab.targetId, title: tab.title, url: tab.url, active: tab.active };
  });
}

function publicUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.username = '';
      url.password = '';
      url.hash = '';
      return url.href.slice(0, 2048);
    }
  } catch {
    /* The URL may be empty while a newly opened tab loads. */
  }
  return 'about:blank';
}

export function createEgoBrowserSession(executablePath: string): EgoBrowserSession {
  const entries = new Map<string, TabEntry>();
  let active: string | undefined;
  let order = 0;
  let spaceId: number | undefined;
  let runtime: EgoRuntime | undefined;
  let initializing: Promise<EgoRuntime> | undefined;
  let closing: Promise<void> | undefined;
  let handedOff = false;

  function retireSpace() {
    entries.clear();
    active = undefined;
    spaceId = undefined;
    handedOff = false;
  }

  async function getRuntime() {
    if (closing) throw unavailable();
    if (runtime) return runtime;
    initializing ??= startEgoRuntime(executablePath);
    try {
      return (runtime = await initializing);
    } catch {
      throw unavailable();
    } finally {
      initializing = undefined;
    }
  }

  async function run(
    operation: EgoOperation,
    payload: Record<string, unknown>,
    options: BrowserTabOptions = {},
  ) {
    check(options);
    const managed = await getRuntime();
    check(options);
    try {
      const result = await managed.run({ operation, spaceId, ...payload }, options.signal);
      check(options);
      return result;
    } catch (error) {
      if (error instanceof EgoSdkError) {
        if (error.code === 'EGO_TASK_SPACE_USER_IN_CONTROL') throw userInControl();
        if (error.code === 'EGO_TAB_MISSING') throw retiredTab();
        if (error.code === 'EGO_TASK_SPACE_NOT_FOUND') {
          retireSpace();
          throw retiredTab();
        }
        if (
          ['EGO_COMMAND_INTERRUPTED', 'EGO_BROWSER_UNAVAILABLE', 'EGO_NO_RESULT'].includes(
            error.code,
          )
        ) {
          await managed.close();
          if (runtime === managed) runtime = undefined;
          retireSpace();
          options.signal?.throwIfAborted();
          throw new Error('Ego Lite 浏览器连接已中断。请重新打开页面后继续。');
        }
      }
      throw new Error('Ego Lite 未能完成此操作，请重新检查活动标签页和页面控件。');
    }
  }

  async function open(options: BrowserTabOptions = {}) {
    if (spaceId !== undefined) return;
    const response = await run(
      'open',
      { name: `aihubot 工作区 ${randomUUID().slice(0, 8)}` },
      options,
    );
    if (
      typeof response.spaceId !== 'number' ||
      !Number.isSafeInteger(response.spaceId) ||
      response.spaceId < 1
    )
      throw unavailable();
    spaceId = response.spaceId;
  }

  function list(value: unknown): BrowserTabList {
    const tabs = nativeTabs(value);
    const seen = new Set(tabs.map((tab) => tab.targetId));
    for (const id of entries.keys()) if (!seen.has(id)) entries.delete(id);
    for (const { targetId } of tabs) {
      if (!entries.has(targetId)) entries.set(targetId, { id: randomUUID(), order: 0 });
    }
    const current = tabs.find((tab) => tab.active);
    if (current && current.targetId !== active) entries.get(current.targetId)!.order = ++order;
    active = current?.targetId;
    return {
      tabs: [...tabs.filter((tab) => tab.active), ...tabs.filter((tab) => !tab.active)]
        .slice(0, 100)
        .map(({ targetId, url, title, active }) => ({
          tabId: entries.get(targetId)!.id,
          title: title.slice(0, 300),
          url: publicUrl(url),
          active,
        })),
      truncated: tabs.length > 100,
    };
  }

  async function changeTab(tabId: string, close: boolean, options: BrowserTabOptions) {
    const targetId = [...entries].find(([, entry]) => entry.id === tabId)?.[0];
    if (!targetId) throw retiredTab();
    let previousTargetId: string | undefined;
    let previousOrder = 0;
    if (close) {
      for (const [id, entry] of entries) {
        if (id !== targetId && entry.order > previousOrder) {
          previousOrder = entry.order;
          previousTargetId = id;
        }
      }
    }
    const result = await run(
      close ? 'closeTab' : 'select',
      { targetId, previousTargetId },
      options,
    );
    if (result.closedSpace === true) retireSpace();
    return list(result.tabs);
  }

  return {
    isOpen: () => spaceId !== undefined,
    async execute(action, options) {
      check(options);
      if (handedOff) throw userInControl();
      if (action.type === 'browser_tabs')
        return spaceId === undefined ? emptyTabs : list((await run('tabs', {}, options)).tabs);
      if (action.type === 'browser_select_tab' || action.type === 'browser_close_tab')
        return changeTab(action.tabId!, action.type === 'browser_close_tab', options);
      if (action.type === 'browser_download' || action.type === 'browser_attach_image')
        throw new Error('Ego Lite 暂不支持自动导出文件或上传图片，请在浏览器中人工操作。');
      if (action.type === 'browser_navigate') {
        const url = new URL(action.url!);
        await resolveBrowserTarget(url);
        await open(options);
        const result = await run('navigate', { url: url.href }, options);
        return { ...result, url: publicUrl(String(result.url || '')) };
      }
      if (spaceId === undefined) throw new Error('请先在 Ego Lite 中打开网页。');
      const operation = pageActions[action.type];
      if (!operation) throw new Error('Ego Lite 不支持此浏览器操作。');
      const result = await run(
        operation,
        { selector: action.selector, text: action.text, direction: action.direction },
        options,
      );
      return { ...result, url: publicUrl(String(result.url || '')) };
    },
    async screenshot(options) {
      if (handedOff) throw userInControl();
      if (spaceId === undefined) throw new Error('请先在 Ego Lite 中打开网页。');
      const { data } = await run('screenshot', {}, options);
      if (typeof data !== 'string' || data.length > 5 * 1024 * 1024) throw unavailable();
      const png = Buffer.from(data, 'base64');
      pngDimensions(png);
      return png;
    },
    async handOff() {
      if (handedOff) return;
      await open();
      await run('handOff', {});
      handedOff = true;
    },
    async resume() {
      if (!handedOff) return;
      await run('resume', {});
      handedOff = false;
    },
    close() {
      closing ??= (async () => {
        try {
          const managed = runtime ?? (await initializing?.catch(() => undefined));
          await managed?.close();
        } finally {
          retireSpace();
          runtime = undefined;
        }
      })();
      return closing;
    },
  };
}
