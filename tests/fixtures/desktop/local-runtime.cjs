'use strict';
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createLocalRuntime } = require('../../../desktop/local-runtime.cjs');

const manifest = {
  version: 1,
  platform: process.platform,
  architecture: process.arch,
  server: 'openbot-backend',
  node: 'bin/node',
  runtime: 'runtime',
};
function bundleFixture(t, body, spec = manifest, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'bambooshift-client-fixture-'));
  const dataDir = join(directory, 'profile');
  const resourcesPath = join(directory, 'Resources');
  const bundle = join(resourcesPath, 'bambooshift-runtime');
  const put = (path, data, mode) => writeFileSync(join(bundle, path), data, { mode });
  for (const path of ['bin', 'runtime/dist', 'runtime/node_modules', 'runtime/packages'])
    mkdirSync(join(bundle, path), { recursive: true });
  for (const name of ['pi', 'computer', 'document', 'mcp']) {
    mkdirSync(join(bundle, 'runtime/packages', name + '-worker'));
    put('runtime/packages/' + name + '-worker/index.mjs', '', 0o600);
  }
  put('runtime/dist/index.html', '<!doctype html>', 0o600);
  put('desktop-runtime.json', JSON.stringify(spec), 0o600);
  put('bin/node', 'runtime fixture', 0o700);
  put('openbot-image-worker', 'image fixture', 0o700);
  put('openbot-backend', '#!' + process.execPath + '\n' + body, 0o700);
  mkdirSync(dataDir, { mode: 0o700 });
  const runtime = createLocalRuntime({
    dataDir,
    resourcesPath,
    startTimeoutMs: 5000,
    stopTimeoutMs: 300,
    ...options,
  });
  t.after(async () => {
    await runtime.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, dataDir, resourcesPath, bundle, runtime };
}

const fixtureServer = `
const http = require('node:http');
const { readFileSync } = require('node:fs');
const config = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/health') {
    res.end(JSON.stringify({ok:true,backend:'rust',architecture:'platform',runtime:'pi'}));
  } else if (req.url === '/api/account/local-session') {
    const valid = req.method === 'POST' && req.headers['x-bambooshift-local-token'] === config.localDesktop.bootstrapToken;
    res.statusCode = valid ? 200 : 403;
    res.end(JSON.stringify({authenticated:valid, workspaceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user:{localOnly:true}}));
  } else {
    const { homedir, username } = require('node:os').userInfo();
    const { HOME, USER, LOGNAME, PATH, BAMBOOSHIFT_FIXTURE_SECRET } = process.env;
    res.end(JSON.stringify({
      pid: process.pid,
      leaked: Boolean(BAMBOOSHIFT_FIXTURE_SECRET),
      hostIdentity: HOME === homedir && USER === username && LOGNAME === username,
      hostPath: PATH === '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    }));
  }
});
server.listen(0, '127.0.0.1', () => {
  const ready = JSON.stringify({type:'openbot:ready',backend:'rust',address:'127.0.0.1:' + server.address().port});
  process.stdout.write(ready.slice(0, 20));
  setTimeout(() => process.stdout.write(ready.slice(20) + '\\n'), 20);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;

module.exports = { bundleFixture, fixtureServer, manifest };
