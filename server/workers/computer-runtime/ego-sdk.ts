// Only this program runs inside the official ego-browser Node SDK. Values from
// actions travel as JSON data. Callers cannot supply JavaScript or CDP methods.
export const egoSdkProgram = String.raw`
async function run(request) {
  function checked(value) {
    if (value?.error) throw Object.assign(new Error(), { error_code: value.error_code });
    return value;
  }

  if (request.operation === 'createProfile') {
    const profile = checked(await ego.createProfile('aihubot 临时工作区'));
    return { profileId: profile.id };
  }
  if (request.operation === 'open') {
    const task = await taskSpace(request.name, { profileId: request.profileId });
    return { spaceId: task.spaceId };
  }

  ego.useTaskSpace(request.spaceId);
  if (request.operation === 'resume') {
    await takeOverTaskSpace(request.spaceId);
    return {};
  }
  if (request.operation === 'closeSpace') {
    checked(await ego.closeTaskSpace());
    return {};
  }
  const task = await taskSpace(request.spaceId);
  if (request.operation === 'handOff') {
    await task.handOff();
    return {};
  }
  async function inventory() {
    return (await task.tabs()).slice(0, 256);
  }
  function describe(tabs) {
    return tabs.map(({ targetId, url, title, active }) => ({
      targetId,
      url: String(url || '').slice(0, 2048),
      title: String(title || '').slice(0, 300),
      active: active === true,
    }));
  }
  const tabs = await inventory();
  if (request.operation === 'tabs') return { tabs: describe(tabs) };
  const tab = request.targetId
    ? tabs.find(item => item.targetId === request.targetId)
    : tabs.find(item => item.active) ?? tabs[0];
  if (!tab) throw Object.assign(new Error(), { error_code: 'EGO_TAB_MISSING' });

  if (request.operation === 'select') {
    await task.cdp('Target.activateTarget', { targetId: tab.targetId });
    const selected = await inventory();
    if (!selected.some(item => item.targetId === tab.targetId && item.active))
      throw Object.assign(new Error(), { error_code: 'EGO_TAB_MISSING' });
    return { tabs: describe(selected) };
  }
  if (request.operation === 'closeTab') {
    if (tabs.length === 1) {
      checked(await ego.closeTaskSpace());
      return { tabs: [], closedSpace: true };
    }
    const closed = await task.cdp('Target.closeTarget', { targetId: tab.targetId });
    if (closed.success !== true) throw Object.assign(new Error(), { error_code: 'EGO_TAB_MISSING' });
    let remaining = await inventory();
    for (let tries = 0; tries < 20 && remaining.some(item => item.targetId === tab.targetId); tries++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      remaining = await inventory();
    }
    if (remaining.some(item => item.targetId === tab.targetId))
      throw Object.assign(new Error(), { error_code: 'EGO_TAB_MISSING' });
    if (tab.active && remaining.some(item => item.targetId === request.previousTargetId)) {
      await task.cdp('Target.activateTarget', { targetId: request.previousTargetId });
      remaining = await inventory();
    }
    return { tabs: describe(remaining) };
  }

  const page = tab.label ? tab.page : await task.adopt(tab.page);
  if (request.operation === 'probe') {
    await page.goto(request.url);
    return { title: await page.title() };
  }
  if (request.operation === 'screenshot') {
    const { data } = await page.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    return { data };
  }
  if (request.operation === 'navigate') {
    await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  } else if (request.operation === 'click') {
    await page.click(request.selector, { timeout: 8_000 });
  } else if (request.operation === 'fill') {
    await page.fill(request.selector, request.text, { timeout: 8_000, clearFirst: true });
  } else if (request.operation === 'scroll') {
    await page.mouse.wheel(0, request.direction === 'up' ? -650 : 650);
  } else if (request.operation === 'back') {
    const { entries, currentIndex } = await page.cdp('Page.getNavigationHistory');
    const previous = entries?.[currentIndex - 1];
    if (previous) await page.cdp('Page.navigateToHistoryEntry', { entryId: previous.id });
  } else {
    throw new Error('Unknown internal Ego operation');
  }
  return page.evaluate(() => {
    const editor = 'input,textarea,select,[role="textbox"],[contenteditable]:not([contenteditable="false" i])';
    const excluded = editor + ',script,style,noscript,template';
    const chunks = [];
    let length = 0;
    const body = document.body;
    const nodes = body && document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        for (let element = node.parentElement; element; element = element.parentElement) {
          if (element.matches(excluded)) return NodeFilter.FILTER_REJECT;
          const style = getComputedStyle(element);
          if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden')
            return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node; length < 16_000 && (node = nodes?.nextNode());) {
      const chunk = (node.textContent || '').slice(0, 16_000 - length).trim();
      if (chunk) { chunks.push(chunk); length += chunk.length + 1; }
    }
    const controls = Array.from(document.querySelectorAll('a,button,' + editor)).slice(0, 100).map(element => ({
      tag: element.tagName.toLowerCase(),
      text: element.matches(editor) ? '' : (element.textContent || '').trim().slice(0, 100),
      id: element.id.slice(0, 200) || undefined,
      name: element.getAttribute('name')?.slice(0, 160),
      placeholder: element.getAttribute('placeholder')?.slice(0, 160),
      ariaLabel: element.getAttribute('aria-label')?.slice(0, 160),
    }));
    const url = new URL(location.href);
    return { url: ['http:', 'https:'].includes(url.protocol) ? url.href.slice(0, 2048) : 'about:blank',
      title: document.title.slice(0, 300), text: chunks.join(' ').slice(0, 16_000), controls };
  });
}
`;
