// @vitest-environment happy-dom
import { RATINGS } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import RatingCard from './RatingCard.vue';

const socket = vi.hoisted(() => ({
  act: vi.fn<(event: string, payload?: object) => Promise<{ ok: true } | { ok: false; error: string }>>(),
}));
vi.mock('../socket', () => socket);
// The feedback form has a test of its own (SendFeedback.test.ts).
vi.mock('./SendFeedback.vue', () => ({ default: { render: () => null } }));

const i18n = (locale: 'en' | 'zh') => createI18n({ legacy: false, locale, messages: { en, zh } });
const global = (locale: 'en' | 'zh' = 'en') => ({ plugins: [i18n(locale)] });

// The card as the room shows it, with what the viewer chose so far, or nothing yet.
const card = (rating: string | null, locale: 'en' | 'zh' = 'en') =>
  mount(RatingCard, {
    props: { gameId: 'g1', rating: { options: [...RATINGS], rating }, question: 'How was this pair of terms?' },
    global: global(locale),
  });
type Card = ReturnType<typeof card>;
const option = (wrapper: Card, label: string) =>
  wrapper.findAll('.options button').find((button) => button.text() === label)!;
const close = (wrapper: Card) => wrapper.get('button.close-button');
const line = (wrapper: Card) => wrapper.get('[role="status"]');

beforeEach(() => {
  socket.act.mockReset();
  socket.act.mockResolvedValue({ ok: true });
});

describe('the rating card', () => {
  test('offers the options as buttons, none pressed, under a grey hint on what × does', () => {
    const wrapper = card(null);
    const options = wrapper.findAll('.options button');
    expect(options.map((button) => button.text())).toEqual(['Good', 'Too hard', 'Too easy', "Something's wrong"]);
    expect(wrapper.get('.options').attributes('role')).toBe('group');
    expect(wrapper.get('.options').attributes('aria-label')).toBe('How was this pair of terms?');
    for (const button of options) {
      expect(button.attributes('type')).toBe('button');
      expect(button.attributes('aria-pressed')).toBe('false');
      expect(button.classes()).toContain('secondary');
    }
    expect(wrapper.find('input').exists()).toBe(false);
    expect(line(wrapper).text()).toBe('Tap × not to rate; you can change it before you leave.');
    expect(line(wrapper).classes()).toEqual(['hint']);
    expect(close(wrapper).attributes('aria-label')).toBe("Don't rate");
  });

  test('sends a tapped option at once, naming the game', async () => {
    const wrapper = card(null);
    await option(wrapper, 'Too hard').trigger('click');
    expect(socket.act).toHaveBeenCalledExactlyOnceWith('room:rate', { gameId: 'g1', rating: 'hard' });
  });

  test('marks the chosen option for screen readers too, and says the rating was noted', () => {
    const wrapper = card('good');
    const pressed = wrapper.findAll('.options button').filter((button) => button.attributes('aria-pressed') === 'true');
    expect(pressed.map((button) => button.text())).toEqual(['Good']);
    expect(pressed[0]!.classes()).toContain('chosen');
    expect(wrapper.findAll('.options button.chosen')).toHaveLength(1);
    expect(line(wrapper).text()).toBe('Noted, thanks for the feedback. You can change it before you leave.');
    expect(line(wrapper).classes()).toEqual(['noted']);
    expect(wrapper.find('.hint').exists()).toBe(false);
  });

  test('says the same in Chinese', () => {
    expect(line(card(null, 'zh')).text()).toBe('点 × 就是不评；离开前可以改。');
    const chosen = card('good', 'zh');
    expect(line(chosen).text()).toBe('已记下，感谢反馈。离开前可以改。');
    expect(close(chosen).attributes('aria-label')).toBe('关闭，评分保留');
    expect(chosen.get('.options button[aria-pressed="true"]').text()).toBe('好题');
  });

  test('changes a rating to another option, and sends nothing for the chosen one again', async () => {
    const wrapper = card('good');
    await option(wrapper, 'Good').trigger('click');
    expect(socket.act).not.toHaveBeenCalled();
    await option(wrapper, 'Too easy').trigger('click');
    expect(socket.act).toHaveBeenCalledExactlyOnceWith('room:rate', { gameId: 'g1', rating: 'easy' });
  });

  test('dismisses the question with × before anything is chosen, sending no rating', async () => {
    const wrapper = card(null);
    await close(wrapper).trigger('click');
    expect(socket.act).toHaveBeenCalledExactlyOnceWith('room:rate', { gameId: 'g1', rating: null });
  });

  test('once a rating is chosen, × only closes the card and keeps the rating', async () => {
    const wrapper = card('good');
    expect(close(wrapper).attributes('aria-label')).toBe('Close, keeping your rating');
    await close(wrapper).trigger('click');
    expect(socket.act).not.toHaveBeenCalled();
    expect(wrapper.find('section.rating').exists()).toBe(false);
  });

  test("shows the next game's card after closing this one's", async () => {
    const wrapper = card('good');
    await close(wrapper).trigger('click');
    await wrapper.setProps({ gameId: 'g2', rating: { options: [...RATINGS], rating: null } });
    expect(wrapper.find('section.rating').exists()).toBe(true);
    expect(line(wrapper).text()).toBe('Tap × not to rate; you can change it before you leave.');
  });

  test('holds the options and × back while a rating is on its way', async () => {
    let answer: (reply: { ok: true }) => void = () => {};
    socket.act.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const wrapper = card(null);
    await option(wrapper, 'Good').trigger('click');
    for (const button of wrapper.findAll('.options button')) expect(button.attributes('disabled')).toBeDefined();
    // A × now would send no rating over the one on its way.
    expect(close(wrapper).attributes('disabled')).toBeDefined();
    answer({ ok: true });
    await flushPromises();
    expect(close(wrapper).attributes('disabled')).toBeUndefined();
  });
});
