import { ArrowUpRight, Loader2 } from 'lucide-react';
import type { SystemBotId } from '../../../../shared/system-bots';
import { uiText } from '../../i18n';
import { systemBots } from '../../systemBots';
import { Avatar } from '../Avatar';
import './SystemBotDirectory.css';

export function SystemBotDirectory({
  canOpen,
  pending,
  error,
  onOpen,
}: {
  canOpen: boolean;
  pending?: SystemBotId;
  error: string;
  onOpen(id: SystemBotId): void;
}) {
  return (
    <section className="system-directory" aria-label={uiText('workspace:systemBotsTab')}>
      <header className="system-directory-header">
        <h3>{uiText('workspace:systemBotsTitle')}</h3>
        <p>{uiText('workspace:systemBotsHelp')}</p>
      </header>
      {error && (
        <p role="alert" className="system-directory-error">
          {error}
        </p>
      )}
      <div className="system-directory-grid">
        {systemBots().map(({ id, profile }) => (
          <article className="system-directory-card" key={id} data-role={id}>
            <div className="system-directory-identity">
              <div className="system-directory-avatar">
                <Avatar agent={profile} size={50} />
              </div>
              <div>
                <h4>{profile.name}</h4>
                <p>{profile.role}</p>
              </div>
            </div>
            <p className="system-directory-description">{profile.description}</p>
            {canOpen && (
              <button
                type="button"
                className="secondary-button system-directory-open"
                aria-label={uiText('workspace:systemBotOpenNamed', { name: profile.name })}
                aria-busy={pending === id}
                disabled={!!pending}
                onClick={() => onOpen(id)}
              >
                {uiText(pending === id ? 'workspace:systemBotOpening' : 'workspace:systemBotOpen')}
                {pending === id ? (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                ) : (
                  <ArrowUpRight size={15} aria-hidden="true" />
                )}
              </button>
            )}
          </article>
        ))}
      </div>
      {!canOpen && <p className="field-help">{uiText('workspace:systemBotOwner')}</p>}
    </section>
  );
}
