import { isLanguage, type Language } from '@reviewer2/shared';
import { createI18n } from 'vue-i18n';
import en from '../locales/en.json';
import zh from '../locales/zh.json';
import { readStored, writeStored } from './storage';

// All interface text lives in the locale files (docs/rules/constraints.md). The home page uses
// the visitor's own language. A room has a language of its own (shared/src/language.ts), which
// setLanguage can show without making it the visitor's choice.

const STORAGE_KEY = 'r2.language';

// What each language is called in a lang attribute.
export const HTML_LANG: Record<Language, string> = { zh: 'zh-CN', en: 'en' };

// The language the visitor chose on an earlier visit, if any.
export function storedLanguage(): Language | null {
  const language = readStored(STORAGE_KEY);
  return isLanguage(language) ? language : null;
}

// A first guess from the browser's own setting.
export function browserLanguage(): Language {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: storedLanguage() ?? browserLanguage(),
  fallbackLocale: 'en',
  messages: { en, zh },
});

// Shows the interface in a language. With remember, it also becomes the visitor's own choice.
export function setLanguage(language: Language, { remember = true } = {}): void {
  i18n.global.locale.value = language;
  document.documentElement.lang = HTML_LANG[language];
  if (remember) writeStored(STORAGE_KEY, language);
}

export function currentLanguage(): Language {
  const locale = i18n.global.locale.value;
  return isLanguage(locale) ? locale : 'en';
}
