// @vitest-environment happy-dom
import { RANK_POINTS, RANKS } from '@reviewer2/shared';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import RankLadder from './RankLadder.vue';

// The ladder of academic ranks (docs/architecture.md#academic-ranks), in a sheet over the page.

const global = (locale: 'en' | 'zh' = 'en') => ({
  plugins: [createI18n({ legacy: false, locale, messages: { en, zh } })],
});
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]');
const rungs = () => [...document.querySelectorAll<HTMLElement>('[role=dialog] .rung')];
const current = () => document.querySelector<HTMLElement>('[role=dialog] .rung.current');

describe('RankLadder', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('lists every rank from the top down, with the points it is held from', () => {
    const wrapper = mount(RankLadder, {
      props: { open: true, rank: 'kindergarten', points: 0 },
      global: global(),
      attachTo: document.body,
    });
    expect(dialog()?.textContent).toContain('The academic ladder');
    expect(rungs()).toHaveLength(RANKS.length);
    expect(rungs()[0]?.textContent).toContain('Reviewer 2');
    expect(rungs()[0]?.textContent).toContain('from 10000 points');
    expect(rungs().at(-1)?.textContent).toContain('Kindergartner');
    expect(rungs().at(-1)?.textContent).toContain('from 0 points');
    expect(rungs()[1]?.textContent).toContain(`from ${RANK_POINTS.academician} points`);
    wrapper.unmount();
  });

  test('marks a newcomer at the bottom, with the first rung alone climbed, and the way up', () => {
    const wrapper = mount(RankLadder, {
      props: { open: true, rank: 'kindergarten', points: 4 },
      global: global(),
      attachTo: document.body,
    });
    expect(current()?.textContent).toContain('Kindergartner');
    expect(current()?.textContent).toContain('Current rank');
    expect(current()?.textContent).toContain('26 more to Primary school pupil.');
    expect(current()?.getAttribute('aria-current')).toBe('true');
    expect(rungs().filter((rung) => rung.classList.contains('reached'))).toHaveLength(1);
    expect(rungs().filter((rung) => rung.getAttribute('aria-current') === 'true')).toHaveLength(1);
    wrapper.unmount();
  });

  test('marks a rung in the middle, with every rung below it climbed', () => {
    const wrapper = mount(RankLadder, {
      props: { open: true, rank: 'phd', points: 950 },
      global: global(),
      attachTo: document.body,
    });
    expect(current()?.textContent).toContain('PhD student');
    expect(current()?.textContent).toContain('250 more to Postdoc.');
    const reached = rungs().filter((rung) => rung.classList.contains('reached'));
    expect(reached.map((rung) => rung.querySelector('.name')?.textContent)).toEqual([
      'PhD student',
      "Master's student",
      'Undergraduate',
      'High school student',
      'Middle school student',
      'Primary school pupil',
      'Kindergartner',
    ]);
    wrapper.unmount();
  });

  test('says at the top that there is no rank past Reviewer 2', () => {
    const wrapper = mount(RankLadder, {
      props: { open: true, rank: 'reviewer2', points: 12_345 },
      global: global(),
      attachTo: document.body,
    });
    expect(current()?.textContent).toContain('Reviewer 2');
    expect(current()?.textContent).toContain('The highest rank there is.');
    expect(rungs().filter((rung) => rung.classList.contains('reached'))).toHaveLength(RANKS.length);
    wrapper.unmount();
  });

  test("marks another player's rank alone, with no points and no way up", () => {
    const wrapper = mount(RankLadder, {
      props: { open: true, rank: 'lecturer' },
      global: global(),
      attachTo: document.body,
    });
    expect(current()?.textContent).toContain('Lecturer');
    expect(current()?.textContent).toContain('Current rank');
    expect(current()?.textContent).not.toContain('more to');
    expect(current()?.textContent).not.toContain('highest rank');
    expect(rungs().filter((rung) => rung.classList.contains('reached'))).toHaveLength(9);
    wrapper.unmount();
  });

  test('speaks Chinese too, and closes from its button', async () => {
    const wrapper = mount(RankLadder, {
      props: { open: true, rank: 'professor', points: 4100 },
      global: global('zh'),
      attachTo: document.body,
    });
    expect(dialog()?.textContent).toContain('学术阶梯');
    expect(current()?.textContent).toContain('教授');
    expect(current()?.textContent).toContain('再得 1900 分升为院士。');
    expect(rungs()[0]?.textContent).toContain('10000 分起');
    dialog()?.querySelector<HTMLButtonElement>('button.close')?.click();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  test('is not on the page while closed', () => {
    const wrapper = mount(RankLadder, {
      props: { open: false, rank: 'professor', points: 4100 },
      global: global(),
      attachTo: document.body,
    });
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });
});
