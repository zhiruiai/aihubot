import catalog from '../../shared/bot-starter-templates.json';
import type { BotProfileDraft } from './botProfiles';
import { currentLanguage } from './i18n';
export type StarterTemplateId = keyof typeof catalog;
const starterIds = Object.keys(catalog) as StarterTemplateId[];
export type StarterTemplate = {
  id: StarterTemplateId;
  category: string;
  profile: BotProfileDraft;
};
export function starterTemplates(): StarterTemplate[] {
  const language = currentLanguage();
  return starterIds.map((id) => {
    const { avatar, color, locales } = catalog[id];
    const { name, role, description, instructions, category } = locales[language];
    return {
      id,
      category,
      profile: {
        name,
        role,
        description,
        instructions,
        avatar: avatar as BotProfileDraft['avatar'],
        color,
        avatarImageId: null,
      },
    };
  });
}
export function filterStarterTemplates(templates: StarterTemplate[], query: string, category = '') {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return templates.filter(
    (item) =>
      (!category || item.category === category) &&
      words.every((word) =>
        `${item.category} ${item.profile.name} ${item.profile.role} ${item.profile.description} ${item.profile.instructions}`
          .toLocaleLowerCase()
          .includes(word),
      ),
  );
}
