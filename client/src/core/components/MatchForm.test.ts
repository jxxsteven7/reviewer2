// @vitest-environment happy-dom
import type { MatchRules } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import MatchForm from './MatchForm.vue';

// The first game's matches take any number of games and have options of their own; the second
// game's take 3, 5 or 7 games and have none, only a line.
vi.mock('../../games', async () => {
  const { defaultMatchRules, keywordsMatchRules } = await import('@reviewer2/shared/keywords');
  const { default: Options } = await import('../../games/keywords/MatchOptions.vue');
  const { default: Note } = await import('../../games/impostor/MatchNote.vue');
  return {
    games: {
      keywords: { match: { Options, defaults: defaultMatchRules, restore: keywordsMatchRules } },
      impostor: {
        match: { Options: Note, defaults: () => ({ games: 3 }), restore: () => null, choices: [3, 5, 7] },
      },
    },
  };
});

const global = () => ({ plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] });
const form = (game: string, rules: MatchRules) =>
  mount(MatchForm, { props: { game, modelValue: rules, valid: true }, global: global() });

describe('the match form', () => {
  test('offers the numbers of games that a game takes as pills, and picks one', async () => {
    const wrapper = form('impostor', { games: 3 });
    const pills = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
    expect(pills.map((pill) => pill.element.parentElement?.textContent?.trim())).toEqual([
      '3 games',
      '5 games',
      '7 games',
    ]);
    expect(pills.map((pill) => pill.element.checked)).toEqual([true, false, false]);
    expect(wrapper.find('input[inputmode="numeric"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('The settings stay the same for the whole match.');
    await pills[1]!.setValue(true);
    expect(wrapper.emitted('update:modelValue')).toEqual([[{ games: 5 }]]);
    // The rules were valid and stay so: nothing to say.
    expect(wrapper.emitted('update:valid')).toBeUndefined();
  });

  test('takes only one of those numbers', () => {
    const wrapper = form('impostor', { games: 4 });
    expect(wrapper.emitted('update:valid')).toEqual([[false]]);
  });

  test('has the number typed for a game that takes any', () => {
    const wrapper = form('keywords', { games: 5, options: { teams: 'fixed', grouping: 'random' } });
    expect(wrapper.get<HTMLInputElement>('input[inputmode="numeric"]').element.value).toBe('5');
    expect(wrapper.text()).not.toContain('5 games');
  });
});
