// The languages the games are played in. A room's language sets both its interface and the
// words on its cards.
export const LANGUAGES = ['zh', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

export const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language);
