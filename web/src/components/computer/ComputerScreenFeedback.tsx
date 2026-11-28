import { Info, MousePointer2 } from 'lucide-react';
import { uiText } from '../../i18n';

export function EgoTakeoverView({ siteUrl }: { siteUrl?: string }) {
  return (
    <div className="computer-screen-empty">
      <MousePointer2 size={34} />
      <h3>{uiText('computer:egoTakeoverTitle')}</h3>
      <p>{uiText('computer:egoTakeoverHelp')}</p>
      {siteUrl && <span>{siteUrl}</span>}
    </div>
  );
}

export function ComputerScreenError({ message }: { message: string }) {
  return message ? (
    <div className="screenshot-error" role="alert">
      <Info size={14} />
      <span>{message}</span>
    </div>
  ) : null;
}
