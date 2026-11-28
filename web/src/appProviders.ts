import catalog from '../../shared/app-providers.json';
import type { ConnectedApp } from '../../shared/app-connections';
export type AppProvider = {
  id: string;
  name: string;
  category: 'productivity' | 'code';
  mark: string;
  url: string;
  keywords: string;
  authType: ConnectedApp['authType'];
  descriptionKey:
    | 'providerNotion'
    | 'providerLinear'
    | 'providerGitHub'
    | 'providerSentry'
    | 'providerAtlassian'
    | 'providerSlack'
    | 'providerMiro'
    | 'providerMonday'
    | 'providerGitLab'
    | 'providerClickUp'
    | 'providerWebflow'
    | 'providerTodoist'
    | 'providerAirtable'
    | 'providerAttio'
    | 'providerIntercom'
    | 'providerMicrosoftLearn'
    | 'providerCloudflareDocs'
    | 'providerDeepWiki'
    | 'providerContext7'
    | 'providerAwsKnowledge'
    | 'providerExa'
    | 'providerMintlifyDocs';
  documentation: string;
};
// Provider-owned endpoints verified against their published documentation.
export const appProviders = catalog as readonly AppProvider[];

export function providerForEndpoint(canonicalUrl: string) {
  return appProviders.find((provider) => new URL(provider.url).href === canonicalUrl);
}

const address = (value: string) => value.replace(/\/$/, '');
export function providerConnection(provider: AppProvider, apps: ConnectedApp[]) {
  return (
    apps.find((app) => address(app.url) === address(provider.url) && app.status === 'connected') ||
    apps.find((app) => address(app.url) === address(provider.url))
  );
}
export function connectionAtAppAddress(url: string, apps: ConnectedApp[]) {
  try {
    const canonical = new URL(url.trim()).href;
    const provider = appProviders.find((item) => address(item.url) === address(canonical));
    return provider
      ? providerConnection(provider, apps)
      : apps.find((app) => app.url === canonical);
  } catch {
    return undefined;
  }
}
export function providerDraft(id: string) {
  const provider = appProviders.find((item) => item.id === id);
  if (!provider) return;
  return {
    name: provider.name,
    url: provider.url,
    authType: provider.authType,
    token: '',
    shared: false,
  };
}
