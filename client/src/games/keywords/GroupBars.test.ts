// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { provideOpenPlayer } from '../../core/playerPanel';
import en from '../../locales/en.json';
import GroupBars from './GroupBars.vue';

const global = () => ({ plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] });

const player = (id: string, online = true) => ({ id, name: id, online });
const groups = [
  {
    team: 'red' as const,
    captain: player('ann'),
    guessers: [player('cat'), player('bob'), player('dan', false), player('eve')],
  },
  { team: 'blue' as const, captain: player('fay', false), guessers: [] },
];
const remaining = { red: 3, blue: 2 };

describe('GroupBars', () => {
  test("shows each group's PI and students, the viewer first, and opens their panels in a room", async () => {
    // In a room, whose page opens a player's panel from an avatar.
    const opened: string[] = [];
    const room = defineComponent({
      setup(_, { slots }) {
        provideOpenPlayer((id) => opened.push(id));
        return () => slots.default?.();
      },
    });
    const wrapper = mount(room, {
      slots: { default: () => h(GroupBars, { groups, remaining, me: 'bob' }) },
      global: global(),
    });
    const [red, blue] = wrapper.findAll('.score');
    expect(red?.get('.sr-only').text()).toBe('Red group');
    expect(red?.get('.pi-tag').text()).toBe('PI');
    // The viewer first, then the others in their order; on a phone two of them and "+2". The viewer
    // is marked no other way.
    const students = red?.findAll('.students .face') ?? [];
    expect(students.map((face) => face.get('.avatar .initial').attributes('data-initial'))).toEqual([
      'B',
      'C',
      'D',
      'E',
    ]);
    expect(red?.find('.avatar.me').exists()).toBe(false);
    expect(students.map((face) => face.classes('extra'))).toEqual([false, false, true, true]);
    expect(red?.get('.more.few').text()).toBe('+2');
    expect(red?.find('.more.many').exists()).toBe(false);
    // Every avatar opens the player's panel, and says whose; "+2" opens nothing.
    const buttons = red?.findAll('button.avatar-button') ?? [];
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
      "View ann's profile",
      "View bob's profile",
      "View cat's profile",
      "View dan's profile",
      "View eve's profile",
    ]);
    await buttons[0]?.trigger('click');
    await buttons[1]?.trigger('click');
    expect(opened).toEqual(['ann', 'bob']);
    expect(red?.get('.more.few').element.closest('button')).toBeNull();
    expect(red?.text()).toContain('3');
    // Dan is offline, as is Fay, the blue PI, who has no students.
    expect(students[2]?.find('.avatar .wait').exists()).toBe(true);
    expect(blue?.find('.pi .avatar .wait').exists()).toBe(true);
    expect(blue?.find('.divider').exists()).toBe(false);
  });

  test('shows pictures alone where the page opens no panel, as on a big screen', () => {
    const wrapper = mount(GroupBars, { props: { groups, remaining, me: null }, global: global() });
    expect(wrapper.find('button.avatar-button').exists()).toBe(false);
    expect(wrapper.findAll('.avatar')).toHaveLength(6);
  });
});
