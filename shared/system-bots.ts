import catalog from './system-bots.json' with { type: 'json' };

export type SystemBotId = keyof typeof catalog;
