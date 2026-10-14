// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import PlayerNumber from './PlayerNumber.vue';
import TitleInfo from './TitleInfo.vue';
import TitlePills from './TitlePills.vue';

// Titles that a tap explains (docs/architecture.md#titles): each opens a sheet with its name, what
// it is and how it is won.

const global = (locale: 'en' | 'zh' = 'en') => ({
  plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })],
});

const sheet = () => document.body.querySelector('[role=dialog]');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TitleInfo', () => {
  test('opens a sheet with the name of the title and what it is, and closes it', async () => {
    const wrapper = mount(TitleInfo, {
      props: { title: { kind: 'duo', duo: 'reviewer2' } },
      global: global(),
      attachTo: document.body,
    });
    const button = wrapper.find('button');
    expect(button.text()).toBe('Your Reviewer 2');
    expect(button.attributes('aria-haspopup')).toBe('dialog');
    expect(sheet()).toBeNull();
    await button.trigger('click');
    expect(sheet()?.querySelector('h2')?.textContent).toBe('Your Reviewer 2');
    expect(sheet()?.textContent).toContain(
      'The friend who has beaten you the most from the other side, at least 3 times.',
    );
    expect(sheet()?.textContent).toContain('Only you see your friend titles.');
    (sheet()?.querySelector('button.close') as HTMLButtonElement).click();
    await wrapper.vm.$nextTick();
    expect(sheet()).toBeNull();
    wrapper.unmount();
  });

  test('shows a title as plain text where nobody taps, as on a screen', () => {
    const wrapper = mount(TitleInfo, {
      props: { title: { kind: 'verdict', verdict: 'oral' }, still: true },
      global: global(),
    });
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).toBe('Accept (Oral)');
  });

  test('explains in Chinese too', async () => {
    const wrapper = mount(TitleInfo, {
      props: { title: { kind: 'streak', streak: 'losses', length: 4, best: true } },
      global: global('zh'),
      attachTo: document.body,
    });
    expect(wrapper.text()).toBe('四投四拒');
    await wrapper.find('button').trigger('click');
    expect(sheet()?.textContent).toContain('记录里最长的连败：连续输了 4 局。');
    expect(sheet()?.textContent).toContain('连续 3 局起才有这个称号。');
    wrapper.unmount();
  });

  test('tells a streak the player is on apart from the longest on their record', async () => {
    const wrapper = mount(TitleInfo, {
      props: { title: { kind: 'streak', streak: 'wins', length: 3, best: false } },
      global: global(),
      attachTo: document.body,
    });
    await wrapper.find('button').trigger('click');
    expect(sheet()?.textContent).toContain('Games won in a row so far: 3.');
    expect(sheet()?.textContent).not.toContain('on the record');
    expect(sheet()?.textContent).toContain('The title comes at 3 in a row.');
    wrapper.unmount();
  });
});

describe('TitlePills', () => {
  test('makes every title, streak and count of contributions a button that explains it', async () => {
    const wrapper = mount(TitlePills, {
      props: {
        titles: [
          { title: 'best_paper', count: 2 },
          { title: 'black_hole', count: 1 },
        ],
        streaks: [{ kind: 'wins', length: 5, title: 'Five Submissions, Five Acceptances' }],
        contributions: [
          { kind: 'idea', count: 3 },
          { kind: 'words', count: 1 },
        ],
      },
      global: global(),
      attachTo: document.body,
    });
    const pills = wrapper.findAll('li > button.pill');
    expect(pills.map((pill) => pill.text())).toEqual([
      'Best Paper Award ×2',
      'Academic Trash',
      'Five Submissions, Five Acceptances',
      'Contributions: Suggestions ×3',
      'Contributions: Word lists',
    ]);
    expect(pills[2]?.classes()).toEqual(expect.arrayContaining(['streak', 'wins']));
    const explained: string[] = [];
    for (const pill of pills) {
      await pill.trigger('click');
      explained.push(sheet()?.querySelector('.body')?.textContent ?? '');
      (sheet()?.querySelector('button.close') as HTMLButtonElement).click();
      await wrapper.vm.$nextTick();
    }
    expect(explained[0]).toContain('the player with the highest total');
    expect(explained[1]).toContain('the lowest total');
    expect(explained[2]).toContain('The longest run of games won in a row on the record: 5.');
    expect(explained[2]).toContain('The title comes at 3 in a row.');
    expect(explained[3]).toContain('A suggestion of theirs was adopted, whether they left a name or not.');
    expect(explained[4]).toContain('Words of theirs for the word lists were adopted');
    wrapper.unmount();
  });

  test('shows the titles that games bring as often as they were won, each explained, in both languages', async () => {
    const titles = [
      { title: 'heavenly_hand' as const, count: 1 },
      { title: 'missed_deadline' as const, count: 3 },
      { title: 'opening_record' as const, count: 2 },
    ];
    const wrapper = mount(TitlePills, { props: { titles }, global: global(), attachTo: document.body });
    const pills = wrapper.findAll('li > button.pill');
    expect(pills.map((pill) => pill.text())).toEqual([
      'Heavenly Hand',
      'Forgot to Submit \u00d73',
      'Opened the Scoring \u00d72',
    ]);
    const explained: string[] = [];
    for (const pill of pills) {
      await pill.trigger('click');
      explained.push(sheet()?.querySelector('.body')?.textContent ?? '');
      (sheet()?.querySelector('button.close') as HTMLButtonElement).click();
      await wrapper.vm.$nextTick();
    }
    expect(explained[0]).toContain('in the turn of its very first clue');
    expect(explained[1]).toContain('Earned again with every missed deadline');
    expect(explained[2]).toContain('names 3 cards or more');
    wrapper.unmount();
    const chinese = mount(TitlePills, { props: { titles }, global: global('zh') });
    expect(chinese.findAll('li > button.pill').map((pill) => pill.text())).toEqual([
      '\u5929\u80e1',
      'DDL\u8fc7\u4e86\u5fd8\u6295\u7a3f \u00d73',
      '\u9996\u5f00\u7eaa\u5f55 \u00d72',
    ]);
  });
});

describe('PlayerNumber', () => {
  test("explains the author's badge, which only the first account has", async () => {
    const author = mount(PlayerNumber, { props: { id: 1 }, global: global(), attachTo: document.body });
    await author.find('button.author').trigger('click');
    expect(sheet()?.textContent).toContain('The first account to register belongs to the author of the game.');
    author.unmount();
    expect(
      mount(PlayerNumber, { props: { id: 2 }, global: global() })
        .find('.author')
        .exists(),
    ).toBe(false);
  });
});
