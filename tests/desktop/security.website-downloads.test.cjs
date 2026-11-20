'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const {
  sharedDownloadIds,
  sharedDownloadFixture,
} = require('../fixtures/desktop/test-fixture.cjs');
const { websiteDownloadRequest } = require('../../desktop/security.cjs');

const origin = 'https://files.example.com';
const workspace = sharedDownloadIds.workspace;
const page = origin + '/w/' + workspace;
const expectedUser = sharedDownloadIds.user;
const version = 'a'.repeat(64);
const project = '/api/workspaces/' + workspace + '/website-projects/' + version;
const asset = project + '/files/reports/audit.csv';

test('native website save routes bind the workspace, immutable project and portable asset path', () => {
  assert.equal(
    websiteDownloadRequest({ expectedUser, path: asset }, page, origin).name,
    'audit.csv',
  );
  const paths = [
    asset + '?v=1',
    asset + '#x',
    project + '/files/../audit.csv',
    project + '/files/%2faudit.csv',
    project + '/files/con.csv',
    project + '/files/run.js',
    project + '/files/page.html',
    project + '/files/brand.svg',
    project + '/files/clip.mp4/',
    project + '/files/x'.repeat(200),
  ];
  for (const path of paths)
    assert.equal(websiteDownloadRequest({ expectedUser, path }, page, origin), null);
  assert.equal(
    websiteDownloadRequest(
      { expectedUser, path: asset },
      page.replace(workspace, 'c'.repeat(36)),
      origin,
    ),
    null,
  );
  assert.equal(websiteDownloadRequest({ expectedUser, path: origin + asset }, page, origin), null);
  assert.equal(
    websiteDownloadRequest({ expectedUser, path: asset, name: 'audit.csv' }, page, origin),
    null,
  );
});

test('the native sheet saves a verified website CSV and ZIP on an explicit main-frame action', async (t) => {
  for (const archive of [false, true])
    await t.test(archive ? 'archive' : 'asset', async () => {
      const f = await sharedDownloadFixture();
      const bytes = archive
        ? Buffer.from('504b030414000000', 'hex')
        : Buffer.from('region,orders\nWest,12');
      const name = archive ? 'website-' + version.slice(0, 12) + '.zip' : 'audit.csv';
      const path = archive ? project + '/download' : asset;
      const invoke = (event = f.event) =>
        f.fake.ipc.get('openbot-files:download-website')(event, { expectedUser, path });
      const manifest = {
        id: version,
        totalBytes: bytes.length,
        files: [
          {
            path: 'reports/audit.csv',
            size: bytes.length,
            mime: 'text/csv',
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
        ],
      };
      try {
        f.setResponse((url) =>
          url.endsWith(project)
            ? Response.json(manifest)
            : new Response(bytes, {
                headers: {
                  'content-type': archive ? 'application/zip' : 'application/octet-stream',
                  'content-disposition': `attachment; filename="${name}"`,
                },
              }),
        );
        f.setHeadResponse(
          () => new Response(null, { headers: { 'content-length': String(bytes.length) } }),
        );
        await assert.rejects(invoke());
        f.arm();
        await assert.rejects(invoke({ ...f.event, senderFrame: { ...f.event.senderFrame } }));
        f.arm();
        assert.deepEqual(await invoke(), { status: 'saved' });
        assert.equal(f.fake.calls.saves[0][1].defaultPath, name);
        assert.deepEqual(readFileSync(f.destination), bytes);
        assert.ok(
          f.requests.every(
            ({ init }) =>
              init.headers['X-OpenBot-Expected-User'] === expectedUser && init.redirect === 'error',
          ),
        );
        assert.equal(f.requests.at(-1).init.method, 'HEAD');
        await assert.rejects(invoke());
        f.assertNoTemps();
      } finally {
        f.close();
      }
    });
});

test('wrong project, MIME, digest, download name or revoked access prevents publication', async (t) => {
  for (const scenario of ['project', 'mime', 'digest', 'name', 'response-mime', 'revoked'])
    await t.test(scenario, async () => {
      const f = await sharedDownloadFixture();
      const data = Buffer.from('region,orders\nWest,12');
      try {
        f.setResponse((url) =>
          url.endsWith(project)
            ? Response.json({
                id: scenario === 'project' ? 'b'.repeat(64) : version,
                totalBytes: data.length,
                files: [
                  {
                    path: 'reports/audit.csv',
                    size: data.length,
                    mime: scenario === 'mime' ? 'text/html' : 'text/csv',
                    sha256:
                      scenario === 'digest'
                        ? '0'.repeat(64)
                        : createHash('sha256').update(data).digest('hex'),
                  },
                ],
              })
            : new Response(data, {
                headers: {
                  'content-type':
                    scenario === 'response-mime' ? 'text/html' : 'application/octet-stream',
                  'content-disposition': `attachment; filename="${scenario === 'name' ? 'other.csv' : 'audit.csv'}"`,
                },
              }),
        );
        f.setHeadResponse(() =>
          scenario === 'revoked'
            ? new Response(null, { status: 403 })
            : new Response(null, { headers: { 'content-length': String(data.length) } }),
        );
        f.arm();
        await assert.rejects(
          f.fake.ipc.get('openbot-files:download-website')(f.event, { expectedUser, path: asset }),
        );
        assert.equal(existsSync(f.destination), false);
        f.assertNoTemps();
      } finally {
        f.close();
      }
    });
});
