import { FileCode2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { BotAgent, Message, Skill } from '../../../shared/types';
import type { FixedWorkspaceApi } from '../fixedWorkspaceApi';
import { currentLanguage, uiText } from '../i18n';
import { skillInstallBody } from '../skillInstallation';
import { skillPackageTextFiles, type ImportedSkillPackage } from '../skillPackageImport';
import { skillWorkflowPackage, skillWorkflowTemplates } from '../skillWorkflowTemplates';
import { SkillInstallation } from './SkillInstallation';
import { Dialog } from './UI';
import './apps/PackagedSkills.css';
import './SystemSkillCard.css';

type Entry = { id: string; name: string; authored: boolean };

function entries(message: Message, role?: BotAgent['systemBot']): Entry[] {
  if (message.role !== 'assistant' || message.status !== 'done' || !message.agentId) return [];
  const authored = message.metadata?.skillProposal as
    { kind?: unknown; agentId?: unknown; skillId?: unknown; name?: unknown } | undefined;
  if (
    role === 'skill-creator' &&
    message.kind === 'skill_proposal' &&
    authored?.kind === 'authored' &&
    message.agentId === authored.agentId &&
    typeof authored.skillId === 'string' &&
    /^[a-f0-9-]{36}$/.test(authored.skillId) &&
    typeof authored.name === 'string'
  )
    return [{ id: authored.skillId, name: authored.name, authored: true }];

  const found = message.metadata?.skillResults as
    { agentId?: unknown; skillIds?: unknown } | undefined;
  if (
    role !== 'skill-finder' ||
    message.kind !== 'skill_results' ||
    found?.agentId !== message.agentId ||
    !Array.isArray(found.skillIds)
  )
    return [];
  const recipes = skillWorkflowTemplates[currentLanguage()];
  return found.skillIds.slice(0, 3).flatMap((id) => {
    const recipe = recipes.find((item) => item.id === id);
    return recipe ? [{ id: recipe.id, name: recipe.name, authored: false }] : [];
  });
}

export default function SystemSkillCard({
  message,
  role,
  bots,
  skills,
  owner,
  current,
  request,
  onChanged,
}: {
  message: Message;
  role?: BotAgent['systemBot'];
  bots: BotAgent[];
  skills: Skill[];
  owner: boolean;
  current: () => boolean;
  request: FixedWorkspaceApi;
  onChanged: () => void;
}) {
  const [review, setReview] = useState<{ title: string; draft: ImportedSkillPackage }>();
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const requestPending = useRef(false);
  const options = entries(message, role);
  const targets = bots.filter((bot) => !bot.sharedBot && !bot.systemBot);
  async function open(entry: Entry) {
    if (requestPending.current || !owner || !current()) return;
    requestPending.current = true;
    setLoading(true);
    setError('');
    try {
      const language = currentLanguage();
      const workflow = skillWorkflowTemplates[language].find(({ id }) => id === entry.id);
      const draft = entry.authored
        ? await request<ImportedSkillPackage>(`/skills/${entry.id}/review-package`)
        : workflow && skillWorkflowPackage(workflow, language).draft;
      if (
        !draft ||
        (entry.authored && draft.name !== entry.name) ||
        draft.name !== draft.skillPackage.root
      )
        throw Error('Mismatched skill package');
      if (current()) setReview({ title: entry.name, draft });
    } catch {
      if (current()) setError(uiText('workspace:systemSkillReviewFailed'));
    } finally {
      requestPending.current = false;
      if (current()) setLoading(false);
    }
  }
  if (!options.length) return <div className="message-bubble">{message.content}</div>;
  return (
    <section className="system-skill-card" aria-label={uiText('workspace:systemSkillPackages')}>
      <div className="system-skill-title">
        <FileCode2 size={16} aria-hidden="true" />
        <strong>{uiText('workspace:systemSkillPackages')}</strong>
      </div>
      <ul>
        {options.map((entry) => (
          <li key={entry.id}>
            <span>{entry.name}</span>
            {owner && (
              <button
                type="button"
                className="secondary-button"
                disabled={loading}
                onClick={() => void open(entry)}
              >
                {uiText(loading ? 'common:loading' : 'workspace:systemSkillReview')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {review && current() && (
        <Dialog
          title={review.title}
          className="system-skill-dialog"
          onClose={() => {
            if (!installing) setReview(undefined);
          }}
          portal
        >
          <p className="field-help">{review.draft.description}</p>
          <SkillInstallation
            skill={review.draft}
            bots={targets}
            skills={skills}
            disabled={!owner}
            canEdit={owner}
            fileContents={skillPackageTextFiles(review.draft.skillPackage)}
            onBusyChange={setInstalling}
            onInstall={async (draft, expected) => {
              if (!owner || !current() || !targets.some((bot) => bot.id === draft.agentId))
                throw Error(uiText('workspace:systemSkillReviewFailed'));
              const value = await request<Skill>(
                '/skills/install',
                'POST',
                skillInstallBody(draft, expected),
              );
              if (
                !current() ||
                value.agentId !== draft.agentId ||
                value.name !== draft.skill.name ||
                value.status !== 'active'
              )
                throw Error(uiText('workspace:systemSkillReviewFailed'));
              onChanged();
              return value;
            }}
            onDone={() => setReview(undefined)}
          />
        </Dialog>
      )}
    </section>
  );
}
