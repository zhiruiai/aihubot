import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('desktop website downloads use a focused main-frame action and the immutable version URL', async () => {
  const wid = '11111111-1111-4111-8111-111111111111';
  const version = 'b'.repeat(64);
  const url = 'http://127.0.0.1/w/' + wid;
  const bundle = await build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { WebsiteProjectPanel } from './web/src/components/WebsiteProjectPanel';
        import { websiteProjectClient } from './web/src/websiteProjects';
        import { initializeLanguage } from './web/src/i18n';
        initializeLanguage().setLanguage('en');
        const project = { id: '${version}', projectKey: 'key', title: 'Project', entry: 'index.html', fileCount: 3, totalBytes: 256 };
        const files = [
          ['index.html','text/html','<a download href="records/report.csv">Report</a><a download href="index.html">Page</a>'],
          ['records/report.csv','text/csv','sku,units'],
          ['unused.csv','text/csv','unused'],
        ].map(([path,mime,source])=>({path,mime,bytes:new TextEncoder().encode(source)}));
        const noop = () => {};
        window.saved = [];
        window.openbotFiles = { downloadWebsiteProject: async input => {
          window.saved.push({...input, active: navigator.userActivation.isActive});
          return {status:'cancelled'};
        }};
        const client = websiteProjectClient(project,{ workspaceId:'${wid}',userId:'viewer',current:()=>true });
        createRoot(document.getElementById('root')).render(<WebsiteProjectPanel project={project}
          state={{kind:'ready',files}} onClose={noop} onRetry={noop} onDiscuss={noop}
          onSaveFile={client.saveFile} onDownload={()=>client.download(new AbortController().signal)}
          downloading={false} downloadFailed={false} />);
      `,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    write: false,
    bundle: true,
    outdir: 'out',
    jsx: 'automatic',
    platform: 'browser',
    define: { 'import.meta.hot': 'undefined', 'process.env.NODE_ENV': '"production"' },
  });
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const requests: string[] = [];
    await page.route('**/*', (route) => {
      if (route.request().url() === url)
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(url);
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js'))!.text,
    });
    const frame = page.frameLocator('iframe');
    const report = frame.getByRole('link', { name: 'Report' });
    await report.waitFor();
    assert.equal(await report.getAttribute('href'), null);
    assert.equal(
      await frame.getByText('Page', { exact: true }).getAttribute('data-ob-project-download'),
      null,
    );
    const save = page.getByRole('button', { name: 'Save records/report.csv' });
    await report.evaluate((element: HTMLElement) => element.click());
    await page.getByRole('heading', { name: 'Project' }).click();
    assert.equal(await save.count(), 0);
    await report.click();
    await save.waitFor();
    assert.equal(await save.evaluate((node) => node === document.activeElement), true);
    const calls = () => page.evaluate(() => Reflect.get(window, 'saved'));
    assert.deepEqual(await calls(), []);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await calls(), []);
    await report.press('Enter');
    await save.click();
    await save.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Download ZIP' }).click();
    const root = '/api/workspaces/' + wid + '/website-projects/' + version;
    assert.deepEqual(await calls(), [
      { expectedUser: 'viewer', path: root + '/files/records/report.csv', active: true },
      { expectedUser: 'viewer', path: root + '/download', active: true },
    ]);
    assert.deepEqual(requests, []);
  } finally {
    await browser.close();
  }
});
