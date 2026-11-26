import sharp from 'sharp';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function launcherArt(master) {
  const doc = new DOMParser({
    errorHandler: () => {
      throw new Error('Invalid SVG icon master.');
    },
  }).parseFromString(master.toString('utf8'), 'image/svg+xml');
  const tile = doc.getElementById('tile');
  const orca = doc.getElementById('orca');
  if (tile?.localName !== 'rect' || orca?.localName !== 'g') {
    throw new Error('The icon master must contain the #tile rectangle and #orca foreground group.');
  }

  // Native launchers supply their own corner mask. Preserve the ocean gradient to all four edges.
  tile.setAttribute('rx', '0');
  tile.setAttribute('ry', '0');
  const serializer = new XMLSerializer();
  const native = Buffer.from(serializer.serializeToString(doc));

  // The PWA safe circle is centered on the 512px canvas. Keep the original foreground transform.
  const safe = doc.createElementNS(orca.namespaceURI, 'g');
  safe.setAttribute('transform', 'translate(256 256) scale(.69) translate(-256 -256)');
  orca.parentNode.insertBefore(safe, orca);
  safe.appendChild(orca);
  return { native, maskable: Buffer.from(serializer.serializeToString(doc)) };
}

export async function exportIcons(root, { check = false } = {}) {
  const master = await readFile(join(root, 'web/public/favicon.svg'));
  // Validate the original XML before the DOM reader can recover a malformed closing tag.
  await sharp(master).metadata();
  const artwork = { standard: master, ...launcherArt(master) };
  const stale = [];
  async function emit(path, bytes) {
    const target = join(root, path);
    if (check) {
      const previous = await readFile(target).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      if (!previous?.equals(bytes)) stale.push(path);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }

  async function png(path, size, variant = 'standard') {
    const density = Math.max(72, (size * 72) / 512);
    const image = sharp(artwork[variant], { density }).resize(size, size);
    // iOS requires RGB even when every pixel of the native variant is opaque.
    if (variant !== 'standard') image.removeAlpha();
    await emit(path, await image.png({ compressionLevel: 9 }).toBuffer());
  }
  for (const copy of [
    'desktop/ui/logo.svg',
    'operations/public/favicon.svg',
    'mobile/assets/branding/icon.svg',
    'docs/showcase/mark.svg',
    'docs/showcase-work/mark.svg',
  ])
    await emit(copy, master);
  await png('desktop/ui/icon.png', 128);
  await png('web/public/icon-192.png', 192);
  await png('web/public/icon-512.png', 512);
  await png('web/public/apple-touch-icon.png', 180, 'native');
  await png('web/public/icon-maskable-512.png', 512, 'maskable');

  const apple = 'mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset';
  const manifest = JSON.parse(await readFile(join(root, apple, 'Contents.json'), 'utf8'));
  for (const { filename, size, scale } of manifest.images) {
    const pixels = Number(size.split('x')[0]) * Number(scale.replace('x', ''));
    await png(`${apple}/${filename}`, pixels, 'native');
  }
  for (const [density, size] of Object.entries({
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxhdpi: 144,
    xxxhdpi: 192,
  })) {
    await png(`mobile/android/app/src/main/res/mipmap-${density}/ic_launcher.png`, size, 'native');
  }

  if (check) {
    if (stale.length) throw new Error(`Run npm run icons to refresh:\n${stale.join('\n')}`);
  } else {
    for (const size of [16, 24, 32, 64, 1024, 2048, 4096]) {
      await png(`.local/branding/icon-${size}.png`, size);
    }
  }
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  await exportIcons(fileURLToPath(new URL('../../', import.meta.url)), { check });
  console.log(
    check
      ? 'All product icons match the master.'
      : 'Updated product icons from the shared SVG master.',
  );
}
