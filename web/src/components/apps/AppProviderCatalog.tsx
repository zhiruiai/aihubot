import { ArrowRight, ArrowUpRight, Plus } from 'lucide-react';
import type { ConnectedApp } from '../../../../shared/app-connections';
import { appConnectionStatus } from '../../appConnections';
import { appProviders, providerConnection } from '../../appProviders';
import { uiText } from '../../i18n';
import { AppProviderMark } from './AppProviderMark';
import './AppProviderCatalog.css';

const categories = ['all', 'productivity', 'code', 'noAuth'] as const;
export type ProviderCategory = (typeof categories)[number];

export function ProviderCategoriesView({
  category,
  onChange,
}: {
  category: ProviderCategory;
  onChange: (value: ProviderCategory) => void;
}) {
  return (
    <div
      className="provider-categories"
      role="group"
      aria-label={uiText('workspace:providerCategories')}
    >
      {categories.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={category === value}
          onClick={() => onChange(value)}
        >
          {uiText(`workspace:providerCategory_${value}`)}
        </button>
      ))}
    </div>
  );
}

export function AppProviderCatalog({
  apps,
  category,
  search,
  canManage,
  busy,
  onSelect,
  onOpen,
}: {
  apps: ConnectedApp[];
  category: ProviderCategory;
  search: string;
  canManage: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const providers = appProviders.filter((provider) => {
    const matchesCategory =
      category === 'all' ||
      provider.category === category ||
      (category === 'noAuth' && provider.authType === 'none');
    const searchable =
      `${provider.name} ${provider.url} ${provider.keywords} ${uiText(`workspace:${provider.descriptionKey}`)}`.toLowerCase();
    return matchesCategory && words.every((word) => searchable.includes(word));
  });
  return (
    <section className="provider-catalog" aria-label={uiText('workspace:providerCatalog')}>
      <h3>{uiText('workspace:providerCatalog')}</h3>
      {providers.length ? (
        <div className="provider-grid">
          {providers.map((provider) => {
            const app = providerConnection(provider, apps);
            const action =
              app?.status === 'connected' ? 'Connected' : app ? 'Continue' : 'Configure';
            const actionLabel = uiText(`workspace:provider${action}Label`, { name: provider.name });
            return (
              <article key={provider.id} className="provider-card">
                <AppProviderMark provider={provider} />
                <div className="provider-title">
                  <strong>{provider.name}</strong>
                  <span className="provider-status" data-status={app?.status}>
                    {app
                      ? appConnectionStatus(app.status)
                      : uiText(`workspace:providerAuth_${provider.authType}`)}
                  </span>
                </div>
                <p className="provider-description">
                  {uiText(`workspace:${provider.descriptionKey}`)}
                </p>
                <div className="provider-card-actions">
                  <a
                    href={provider.documentation}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={uiText('workspace:providerDocumentationLabel', {
                      name: provider.name,
                    })}
                    title={uiText('workspace:providerDocumentationLabel', { name: provider.name })}
                  >
                    <span>{uiText('workspace:providerDocumentation')}</span>
                    <ArrowUpRight size={12} />
                  </a>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || (!app && !canManage)}
                    aria-label={actionLabel}
                    title={actionLabel}
                    onClick={() => (app ? onOpen(app.id) : onSelect(provider.id))}
                  >
                    {app ? (
                      <ArrowRight size={14} aria-hidden="true" />
                    ) : (
                      <Plus size={14} aria-hidden="true" />
                    )}
                    {uiText(`workspace:provider${action}`)}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="field-help">{uiText('workspace:providerNoResults')}</p>
      )}
    </section>
  );
}
