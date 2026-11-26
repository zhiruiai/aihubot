import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { exportIcons } from '../../scripts/branding/export-icons.mjs';

test('exports preserve the gradient, launcher masks and manifest densities, and detect stale copies', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aihubot-icon-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const apple = 'mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset';
  await mkdir(join(root, 'web/public'), { recursive: true });
  await mkdir(join(root, apple), { recursive: true });
  await cp(
    new URL(`../../${apple}/Contents.json`, import.meta.url),
    join(root, apple, 'Contents.json'),
  );
  // Different attribute ordering and a pre-existing foreground transform exercise the master contract.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><linearGradient id="ocean"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
    <rect width="512" height="512" rx="112" fill="url(#ocean)" id="tile"/>
    <g transform="translate(24 20)" id="orca"><rect x="376" y="200" width="80" height="80" fill="#00ff00"/></g>
  </svg>`;
  await writeFile(join(root, 'web/public/favicon.svg'), svg);
  await exportIcons(root);
  const read = async (path) => sharp(join(root, path)).raw().toBuffer({ resolveWithObject: true });
  const pixel = ({ data, info: { width, channels } }, x, y) => {
    const start = (y * width + x) * channels;
    return [...data.subarray(start, start + channels)];
  };
  const scaleIcon = await read(`${apple}/Icon-App-83.5x83.5@2x.png`);
  assert.equal(scaleIcon.info.width, 167);
  const native = await read(`${apple}/Icon-App-1024x1024@1x.png`);
  assert.equal(native.info.channels, 3);
  assert.ok(pixel(native, 0, 0)[0] > 250);
  assert.ok(pixel(native, 1023, 1023)[2] > 250);
  assert.deepEqual(pixel(native, 900, 510), [0, 255, 0]);
  const android = await read('mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
  assert.equal(android.info.width, 192);
  assert.equal(android.info.channels, 3);
  const maskable = await read('web/public/icon-maskable-512.png');
  assert.equal(maskable.info.channels, 3);
  assert.deepEqual(pixel(maskable, 390, 255), [0, 255, 0]);
  assert.equal(pixel(maskable, 450, 255)[1], 0);
  assert.equal(pixel(await read('desktop/ui/icon.png'), 0, 0)[3], 0);
  assert.equal(await readFile(join(root, 'mobile/assets/branding/icon.svg'), 'utf8'), svg);
  // Local review previews are optional. Checking tracked assets never repairs drift.
  await rm(join(root, '.local'), { recursive: true });
  await exportIcons(root, { check: true });
  const stale = 'operations/public/favicon.svg';
  await writeFile(join(root, stale), 'outdated');
  await assert.rejects(exportIcons(root, { check: true }), /operations\/public\/favicon\.svg/);
  assert.equal(await readFile(join(root, stale), 'utf8'), 'outdated');
  const malformed = svg.replace('</svg>', '</unopened></svg>');
  await writeFile(join(root, 'web/public/favicon.svg'), malformed);
  await assert.rejects(exportIcons(root), /xml|svg/i);
  assert.equal(await readFile(join(root, stale), 'utf8'), 'outdated');
});
