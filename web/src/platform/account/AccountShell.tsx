import { uiText } from '../../i18n/account';
import { type ReactNode } from 'react';
import { AppBrandMark } from '../../components/AppBrandMark';
import '../Platform.css';
export function AccountShell({
  title,
  subtitle,
  children,
  operator = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  operator?: boolean;
}) {
  return (
    <main className={`platform-auth ${operator ? 'is-operator' : ''}`}>
      <a className="platform-brand" href={operator ? '/admin/login' : '/login'}>
        <AppBrandMark size={36} />
        <span>aihubot{operator && <small>{uiText('account:text_e0f17eefe421')}</small>}</span>
      </a>
      <section className="platform-auth-card">
        <h1>{title}</h1>
        {subtitle && <p className="platform-auth-subtitle">{subtitle}</p>}
        {children}
      </section>
      {operator && <footer>{uiText('account:text_e49a9a1fcfdf')}</footer>}
    </main>
  );
}
