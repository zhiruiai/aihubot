import type { Conversation, Skill } from '../../../shared/types';

export const studyLessons = [
  { file: 'ten-frame.html', label: 'workspace:studyTenLabel', draft: 'workspace:studyTenDraft' },
  {
    file: 'equation-balance.html',
    label: 'workspace:studyEquationLabel',
    draft: 'workspace:studyEquationDraft',
  },
] as const;

export type StudyLesson = (typeof studyLessons)[number];

export function hasStudyPractice(conversation: Conversation | undefined, skills: Skill[]) {
  return (
    conversation?.isGroup &&
    conversation.teamBrief?.starterTemplateId === 'study' &&
    skills.some(
      (skill) =>
        skill.agentId === conversation.agentIds[0] &&
        skill.status === 'active' &&
        skill.skillPackage?.root === 'pep-math-practice',
    )
  );
}
