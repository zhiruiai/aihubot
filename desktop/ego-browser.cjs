'use strict';
const { spawnSync } = require('node:child_process');
const { accessSync, constants, realpathSync } = require('node:fs');
const { join } = require('node:path');

const bundle = '/Applications/ego lite.app';
const requirement =
  'anchor apple generic and identifier "com.citrolabs.ego.lite" and certificate leaf[subject.OU] = "JGQLC6YQYJ"';

/** Accept only the vendor's signed app in the normal installation location. */
function installedEgoBrowser(platform) {
  if (platform !== 'darwin') return;
  try {
    if (realpathSync(bundle) !== bundle) return;
    const executablePath = join(bundle, 'Contents/MacOS/ego lite');
    accessSync(executablePath, constants.X_OK);
    const check = spawnSync(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '-R', '=' + requirement, bundle],
      {
        stdio: 'ignore',
        timeout: 4000,
      },
    );
    if (check.status === 0) return { executablePath };
  } catch {
    // A missing or incomplete installation leaves the other browser available.
  }
}

module.exports = { installedEgoBrowser };
