import { isLanguage, type Language } from '@reviewer2/shared';
import { computed, type ComputedRef } from 'vue';
import { createI18n, useI18n } from 'vue-i18n';
import en from '../locales/en.json';
import zh from '../locales/zh.json';
import { HTML_LANG } from './site';
import { readStored, writeStored } from './storage';

// All interface text lives in the locale files (docs/rules/constraints.md). The home page uses
// the visitor's own language. A room has a language of its own (shared/src/language.ts), which
// setLanguage can show without making it the visitor's choice.

const STORAGE_KEY = 'r2.language';

export { HTML_LANG };

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

// The language that a locale is: English for one that is neither, which nothing sets.
const languageOf = (locale: string): Language => (isLanguage(locale) ? locale : 'en');

export function currentLanguage(): Language {
  return languageOf(i18n.global.locale.value);
}

// The language a component's interface is in, which follows the switcher.
export function useLanguage(): ComputedRef<Language> {
  const { locale } = useI18n();
  return computed(() => languageOf(locale.value));
}

// Words in a list, joined the way the language joins them: "Ann and Cat" in English, and with
// the Chinese word for "and" in Chinese. Browsers without Intl.ListFormat get the language's
// plain separator: a comma, or the Chinese enumeration comma.
export function formatList(locale: string, items: readonly string[]): string {
  if (typeof Intl.ListFormat === 'function') {
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
  }
  return items.join(locale.startsWith('zh') ? '\u3001' : ', ');
}
