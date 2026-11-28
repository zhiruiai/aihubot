import catalog from '../../shared/system-bots.json';
import type { SystemBotId } from '../../shared/system-bots';
import type { BotAgent } from '../../shared/types';
import type { ConfirmedBotInstall } from './botTemplates';
import { currentLanguage } from './i18n';
import { starterTemplates } from './starterTemplates';

export const systemBotIds = Object.keys(catalog) as SystemBotId[];

export function systemBots() {
  const language = currentLanguage();
  const recruiter = starterTemplates().find(({ id }) => id === catalog.recruiter.starterId)!;
  return systemBotIds.map((id) => {
    const entry = catalog[id];
    const profile: Pick<BotAgent, 'name' | 'role' | 'description' | 'avatar' | 'color'> =
      'locales' in entry
        ? {
            ...entry.locales[language],
            avatar: entry.avatar as BotAgent['avatar'],
            color: entry.color,
          }
        : recruiter.profile;
    return { id, profile };
  });
}

const systemStarters = new Set(
  Object.values(catalog).flatMap((entry) => ('starterId' in entry ? [entry.starterId] : [])),
);
export const systemStarterIds = starterTemplates()
  .filter(({ id }) => systemStarters.has(id))
  .map(({ id }) => id);

export function systemBotPrompt(id: SystemBotId | undefined) {
  return id && Object.hasOwn(catalog, id) ? catalog[id].prompts[currentLanguage()] : undefined;
}

export function systemBotReceipt(value: unknown, id: SystemBotId): ConfirmedBotInstall {
  const result = value as
    | (ConfirmedBotInstall & { systemBot: SystemBotId; agentId: string; conversationId: string })
    | null;
  const agent = result?.agent;
  const conversation = result?.conversation;
  if (
    result?.systemBot !== id ||
    agent?.systemBot !== id ||
    typeof agent.id !== 'string' ||
    !agent.id ||
    result.agentId !== agent.id ||
    agent.sharedBot ||
    typeof agent.name !== 'string' ||
    typeof agent.role !== 'string' ||
    typeof conversation?.id !== 'string' ||
    !conversation.id ||
    typeof conversation.title !== 'string' ||
    result.conversationId !== conversation.id ||
    conversation.isGroup !== false ||
    conversation.demo ||
    !Array.isArray(conversation.agentIds) ||
    conversation.agentIds.length !== 1 ||
    conversation.agentIds[0] !== agent.id
  )
    throw Error('Invalid system Bot receipt');
  return { agent, conversation };
}
