# Product icon

aihubot's icon pairs an orca swimming upward with a bright turquoise and ocean-blue tile. The dorsal fin, forked tail, white eye patch and white underside keep the mark recognizable at favicon sizes.

[The SVG master](../web/public/favicon.svg) is the editable source. It has no fonts, external images or filters. Do not edit generated PNGs independently.

Run `npm run icons` to refresh the Web and PWA icons, desktop setup and Linux window artwork, iOS and Android launchers, and public showcase marks. The desktop packager derives macOS ICNS and Windows ICO from the same master. Native mobile artwork uses an opaque, edge-to-edge tile. The maskable PWA export scales the orca within the central safe circle while keeping the full-color background at the edges.

Inspect the generated icons at 16, 24, 32, 64 and 1024 pixels on light and dark backgrounds before changing the master. The export command writes local previews in `.local/branding`. Run `npm run icons -- --check` to verify that the distributed icons match the master. Product artwork is distributed under the repository license.

See [Avatar animation](avatar-animation.md) for character artwork, task expressions and animation attribution.
