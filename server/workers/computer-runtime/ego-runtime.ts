import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createBrowserNetworkProxy } from '../computer-worker/network.js';
import { browserEnvironment } from './browser-environment.js';
import { egoSdkProgram } from './ego-sdk.js';

export type EgoOperation =
  | 'createProfile'
  | 'open'
  | 'probe'
  | 'tabs'
  | 'select'
  | 'closeTab'
  | 'closeSpace'
  | 'navigate'
  | 'click'
  | 'fill'
  | 'scroll'
  | 'back'
  | 'screenshot'
  | 'handOff'
  | 'resume';
type SdkRequest = { operation: EgoOperation; spaceId?: number } & Record<string, unknown>;

export class EgoSdkError extends Error {
  constructor(readonly code: string) {
    super('Ego Lite could not complete this browser operation.');
  }
}

export interface EgoRuntime {
  run(request: SdkRequest, signal?: AbortSignal): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export function egoCliPath(executablePath: string) {
  return join(
    dirname(executablePath),
    '../Frameworks/ego Framework.framework/Versions/Current/Helpers/ego-browser',
  );
}

function exitResult(child: ChildProcess) {
  return new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code));
    child.once('error', () => resolve(null));
  });
}

function checkedId(result: Record<string, unknown>) {
  if (
    typeof result.spaceId !== 'number' ||
    !Number.isSafeInteger(result.spaceId) ||
    result.spaceId < 1
  )
    throw new EgoSdkError('EGO_INVALID_RESULT_PAYLOAD');
  return result.spaceId;
}

function namedEndpointReady(instance: string): Promise<boolean> {
  const service = `com.citrolabs.ego.lite.ego-browser.${instance}`;
  return new Promise((resolve) => {
    execFile(
      '/bin/launchctl',
      ['print', `gui/${process.getuid?.()}`],
      {
        timeout: 1000,
        maxBuffer: 2 * 1024 * 1024,
        env: { LANG: 'C' },
      },
      (error, stdout) => {
        if (error) return resolve(false);
        // Named Mach endpoints appear in launchctl's endpoint table. Exact
        // matching and fail-closed behavior protect against an SDK auto-launch.
        resolve(
          stdout.split('\n').some((line) => {
            const columns = line.trim().split(/\s+/);
            return /^0x[0-9a-f]+$/i.test(columns[0]) && columns.at(-1) === service;
          }),
        );
      },
    );
  });
}

export async function startEgoRuntime(executablePath: string): Promise<EgoRuntime> {
  const helper = egoCliPath(executablePath);
  await Promise.all([access(executablePath, constants.X_OK), access(helper, constants.X_OK)]);
  const directory = await mkdtemp(join(tmpdir(), 'aihubot-ego-browser-'));
  try {
    return await startDedicatedInstance(executablePath, helper, directory);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function startDedicatedInstance(
  executablePath: string,
  helper: string,
  stateDirectory: string,
) {
  const home = join(stateDirectory, 'home');
  const profile = join(stateDirectory, 'profile');
  await Promise.all([mkdir(home, { mode: 0o700 }), mkdir(profile, { mode: 0o700 })]);
  const env = { ...browserEnvironment(home), CFFIXED_USER_HOME: home };
  const instance = `aihubot-${randomUUID()}`;
  const instanceArg = `--ego-server-name=${instance}`;
  const probe = `http://${instance}.aihubot.test`;
  const proxy = await createBrowserNetworkProxy(probe);
  const browser = spawn(
    executablePath,
    [
      instanceArg,
      '--skip-onboarding',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-updater-scheduler',
      '--disable-sync',
      '--disable-crash-reporter',
      // The isolated home cannot use the regular macOS Keychain in Ego 0.6.4.22.
      // This owner-only profile is temporary and removed on shutdown.
      '--use-mock-keychain',
      `--user-data-dir=${profile}`,
      `--proxy-server=${proxy.url}`,
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      'about:blank',
    ],
    { env, cwd: home, detached: true, stdio: 'ignore' },
  );
  const exited = exitResult(browser);
  let alive = true;
  void exited.then(() => {
    alive = false;
  });
  let closing: Promise<void> | undefined;
  let profileId: string | undefined;
  const stopGroup = (signal: NodeJS.Signals) => {
    if (!browser.pid) return;
    try {
      process.kill(-browser.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };

  const runtime: EgoRuntime = {
    async run(request, signal) {
      if (!alive || closing || !(await namedEndpointReady(instance)))
        throw new EgoSdkError('EGO_BROWSER_UNAVAILABLE');
      signal?.throwIfAborted();
      const encoded = Buffer.from(JSON.stringify({ ...request, profileId })).toString('base64');
      const marker = `aihubot-ego-${randomUUID()} `;
      const script = `${egoSdkProgram}
        try {
          const value = await run(JSON.parse(Buffer.from('${encoded}', 'base64').toString('utf8')));
          console.log('${marker}' + JSON.stringify({ ok: true, value }));
        } catch (error) {
          const code = typeof error?.error_code === 'string' ? error.error_code : error?.code;
          console.log('${marker}' + JSON.stringify({ ok: false, code }));
        }
      `;
      const command = spawn(helper, [instanceArg, 'nodejs'], { env, cwd: home, stdio: 'pipe' });
      const complete = exitResult(command);
      let output = '';
      let interrupted = false;
      const interrupt = () => {
        interrupted = true;
        command.kill('SIGKILL');
      };
      const timer = setTimeout(interrupt, 20_000);
      signal?.addEventListener('abort', interrupt, { once: true });
      const accumulate = (part: string) => {
        output += part;
        if (output.length > 5 * 1024 * 1024) interrupt();
      };
      // The native Node helper writes console.log to stderr on current macOS releases.
      command.stdout.setEncoding('utf8').on('data', accumulate);
      command.stderr.setEncoding('utf8').on('data', accumulate);
      command.stdin.on('error', () => {});
      command.stdin.end(script);
      try {
        const code = await complete;
        if (interrupted) throw new EgoSdkError('EGO_COMMAND_INTERRUPTED');
        if (code !== 0) throw new EgoSdkError('EGO_BROWSER_UNAVAILABLE');
        const result = output.split(/\r?\n/).findLast((line) => line.startsWith(marker));
        if (!result) throw new EgoSdkError('EGO_NO_RESULT');
        const decoded = JSON.parse(result.slice(marker.length));
        if (!decoded.ok)
          throw new EgoSdkError(
            typeof decoded.code === 'string' ? decoded.code : 'EGO_OPERATION_FAILED',
          );
        if (!decoded.value || typeof decoded.value !== 'object' || Array.isArray(decoded.value))
          throw new EgoSdkError('EGO_INVALID_RESULT_PAYLOAD');
        return decoded.value;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', interrupt);
      }
    },
    close() {
      closing ??= (async () => {
        try {
          stopGroup('SIGTERM');
          const force = setTimeout(() => stopGroup('SIGKILL'), 3_000);
          try {
            await exited;
          } finally {
            clearTimeout(force);
          }
        } finally {
          await proxy.close().finally(() => rm(stateDirectory, { recursive: true, force: true }));
        }
      })();
      return closing;
    },
  };
  try {
    const deadline = Date.now() + 20_000;
    let spaceId: number | undefined;
    while (alive && Date.now() < deadline) {
      try {
        const profileResult = await runtime.run(
          { operation: 'createProfile' },
          AbortSignal.timeout(5_000),
        );
        if (
          typeof profileResult.profileId !== 'string' ||
          !/^Profile [1-9]\d*$/.test(profileResult.profileId)
        )
          throw new EgoSdkError('EGO_INVALID_PROFILE');
        profileId = profileResult.profileId;
        spaceId = checkedId(await runtime.run({ operation: 'open', name: `${instance}-probe` }));
        break;
      } catch (error) {
        if (
          !(error instanceof EgoSdkError) ||
          !['EGO_BROWSER_UNAVAILABLE', 'EGO_NO_RESULT', 'EGO_COMMAND_INTERRUPTED'].includes(
            error.code,
          )
        )
          throw error;
        await delay(200);
      }
    }
    if (spaceId === undefined) throw new EgoSdkError('EGO_BROWSER_UNAVAILABLE');
    const result = await runtime.run({ operation: 'probe', spaceId, url: `${probe}/` });
    if (result.title !== 'aihubot managed browser proxy')
      throw new EgoSdkError('EGO_PROXY_UNVERIFIED');
    await runtime.run({ operation: 'closeSpace', spaceId });
    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
