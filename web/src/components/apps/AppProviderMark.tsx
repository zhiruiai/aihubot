import { Link2 } from 'lucide-react';
import { providerForEndpoint, type AppProvider } from '../../appProviders';
import './AppProviderCatalog.css';

const bundledMarks = new Map<string, string>([
  ['atlassian', '/app-provider-icons/atlassian.svg'],
  ['exa', '/app-provider-icons/exa.svg'],
  ['github', '/app-provider-icons/github.svg'],
  ['intercom', '/app-provider-icons/intercom.jpg'],
  ['linear', '/app-provider-icons/linear.svg'],
  ['sentry', '/app-provider-icons/sentry.svg'],
  ['webflow', '/app-provider-icons/webflow.svg'],
]);

export function AppProviderMark({
  provider,
  endpoint,
}: {
  provider?: AppProvider;
  endpoint?: string;
}) {
  const match = provider ?? (endpoint ? providerForEndpoint(endpoint) : undefined);
  const icon = match && bundledMarks.get(match.id);
  return (
    <span className="provider-mark" data-branded={icon ? '' : undefined} aria-hidden="true">
      {icon ? (
        <img src={icon} alt="" width={23} height={23} />
      ) : (
        (match?.mark ?? <Link2 size={18} />)
      )}
    </span>
  );
}
