import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { KILO_FREE_PROFILE } from '../../../../shared/free-model.js';
import type { StartRun } from '../../agent-runtime/protocol.js';

/** Each child receives one profile and cannot discover host credentials. */
export async function createWorkerModel(
  pi: { ModelRuntime: typeof ModelRuntime },
  run: StartRun,
  signal: AbortSignal,
) {
  const profile = run.profile;
  const isKiloFree = profile.provider === KILO_FREE_PROFILE.provider;
  if (
    isKiloFree &&
    (profile.baseUrl !== KILO_FREE_PROFILE.baseUrl ||
      profile.model !== KILO_FREE_PROFILE.model ||
      profile.apiKey ||
      profile.vision)
  )
    throw Error('Kilo Free requires the official anonymous text model endpoint.');
  if (!profile.baseUrl && ['google-vertex', 'amazon-bedrock'].includes(profile.provider))
    throw Error('Ambient cloud credential providers are unavailable.');
  if (profile.baseUrl) {
    const url = new URL(profile.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error('Invalid model endpoint.');
  }
  const runtime = await pi.ModelRuntime.create({
    credentials: {
      async read() {
        return undefined;
      },
      async list() {
        return [];
      },
      async modify() {
        throw Error('Only the Rust host can change credentials.');
      },
      async delete() {},
    },
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    signal,
  });
  const apiKey = profile.apiKey || (profile.baseUrl ? 'local' : undefined);
  const headers: Record<string, null> = { 'OpenAI-Organization': null, 'OpenAI-Project': null };
  // The SDK requires a nonempty local value. Delete the HTTP auth header for anonymous inference.
  if (isKiloFree) headers.Authorization = null;
  runtime.getAuth = async (value, options) => {
    options?.signal?.throwIfAborted();
    const provider = typeof value === 'string' ? value : value.provider;
    if (provider !== profile.provider || !apiKey) return undefined;
    return {
      auth: { apiKey, headers },
      env: {},
      source: 'workspace-profile',
    };
  };
  runtime.checkAuth = async (provider) =>
    provider === profile.provider && apiKey
      ? { type: 'api_key', source: 'workspace-profile' }
      : undefined;
  if (profile.baseUrl)
    await runtime.registerProvider(profile.provider, {
      baseUrl: profile.baseUrl,
      api: 'openai-completions',
      apiKey: 'local',
      models: [
        {
          id: profile.model,
          name: profile.model,
          reasoning: false,
          input: profile.vision ? ['text', 'image'] : ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        },
      ],
    });
  if (apiKey) await runtime.setRuntimeApiKey(profile.provider, apiKey, { signal });
  const model = runtime.getModel(profile.provider, profile.model);
  if (!model) throw Error('The configured model is unavailable.');
  return { runtime, model };
}
