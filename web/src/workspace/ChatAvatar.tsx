import type { ApprovalActor } from '../../../shared/approvals';
import type { BotAgent, Message, RunActivity } from '../../../shared/types';
import { Avatar } from '../components/Avatar';
import { messageAvatarMotion } from '../avatarActivity';
import { uiText } from '../i18n';
export { messageAvatarMotion } from '../avatarActivity';

const activityLabels = {
  research: 'workspace:runActivityResearch',
  files: 'workspace:runActivityFiles',
  website: 'workspace:runActivityWebsite',
  skill: 'workspace:runActivitySkill',
  collaborating: 'workspace:runActivityCollaborating',
  connectedApp: 'workspace:runActivityConnectedApp',
  computer: 'workspace:runActivityComputer',
} as const satisfies Record<RunActivity, string>;

export function ChatMessageAvatar({
  message,
  agent,
  actor,
  streaming,
  active = false,
  grouped,
  teammate,
}: {
  message: Message;
  agent?: Partial<BotAgent>;
  actor: ApprovalActor;
  streaming: boolean;
  active?: boolean;
  grouped: boolean;
  teammate?: string;
}) {
  const state = messageAvatarMotion(message, streaming, actor);
  const motion = !active && (state === 'working' || state === 'thinking') ? undefined : state;
  return (
    <div className="message-avatar">
      {!grouped && message.role === 'assistant' && (
        <Avatar
          agent={agent}
          size={32}
          motion={motion}
          sustain={active && (motion === 'working' || motion === 'thinking')}
          awaitingCompletion={
            active &&
            (!message.kind || message.kind === 'text') &&
            message.status === 'running' &&
            message.metadata?.streamEnded === true
          }
        />
      )}
      {!grouped && teammate !== undefined && (
        <span className="user-avatar teammate-avatar">{Array.from(teammate)[0]}</span>
      )}
    </div>
  );
}

export function ChatWorkingAvatar({
  agent,
  last,
  actor,
  activity,
}: {
  agent?: BotAgent;
  last?: Message;
  actor: ApprovalActor;
  activity?: RunActivity;
}) {
  const label =
    activity && Object.hasOwn(activityLabels, activity) ? activityLabels[activity] : undefined;
  const motion = last?.role === 'assistant' ? messageAvatarMotion(last, false, actor) : undefined;
  if (
    (!agent || last?.agentId === agent.id) &&
    (motion === 'attention' || (!label && (motion === 'working' || motion === 'thinking')))
  )
    return null;
  return (
    <div className="working-line" role="status" data-tool-active={label ? '' : undefined}>
      <Avatar
        key={agent?.id}
        agent={agent}
        size={32}
        motion={label ? 'working' : 'thinking'}
        sustain
      />
      <span className="typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label && agent && <strong>{agent.name}</strong>}
      <span>
        {label
          ? uiText(label)
          : agent
            ? uiText('workspace:timelineWorker', { name: agent.name })
            : uiText('workspace:text_e556fe53f2b0')}
      </span>
    </div>
  );
}
