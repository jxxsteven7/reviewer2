// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import { provideOpenPlayer } from '../playerPanel';
import { shownProfile } from '../profilePanel';
import AvatarButton from './AvatarButton.vue';
import BackButton from './BackButton.vue';
import FieldPicker from './FieldPicker.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import PlayerName from './PlayerName.vue';
import ProfilePanel from './ProfilePanel.vue';
import UiSheet from './UiSheet.vue';

// The panel that an avatar opens outside a room reads the page, which no server answers here.
vi.mock('../account', async (actual) => ({
  ...(await actual<typeof import('../account')>()),
  request: vi.fn(async () => ({ ok: false, error: 'no_such_profile' })),
}));

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });
const global = () => ({ plugins: [i18n()] });

describe('PlayerName', () => {
  test('marks the viewer, the chair and offline players', () => {
    const wrapper = mount(PlayerName, {
      props: { player: { id: 'a', name: 'Ann', online: false }, me: true, chair: true },
      global: global(),
    });
    expect(wrapper.text()).toContain('Ann');
    expect(wrapper.text()).toContain('you');
    expect(wrapper.text()).toContain('chair');
    expect(wrapper.text()).toContain('offline');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  test("opens the player's panel from the avatar in a room, and leaves the name as text", async () => {
    const opened: string[] = [];
    const room = defineComponent({
      setup(_, { slots }) {
        provideOpenPlayer((id) => opened.push(id));
        return () => slots.default?.();
      },
    });
    const player = { id: 'b', name: 'Bob', online: true };
    const wrapper = mount(room, {
      slots: { default: () => h(PlayerName, { player, me: false, chair: false }) },
      global: global(),
    });
    const button = wrapper.get('button.avatar-button');
    expect(button.attributes('aria-label')).toBe("View Bob's profile");
    expect(wrapper.get('.name').element.tagName).toBe('SPAN');
    await button.trigger('click');
    expect(opened).toEqual(['b']);
  });

  test('shows the academic rank of a player with an account, and none for a guest', () => {
    const ranked = mount(PlayerName, {
      props: {
        player: { id: 'a', name: 'Ann', online: true, rank: 'phd' as const },
        me: false,
        chair: false,
      },
      global: global(),
    });
    expect(ranked.find('.rank').text()).toBe('PhD student');
    const guest = mount(PlayerName, {
      props: { player: { id: 'b', name: 'Bob', online: true }, me: false, chair: false },
      global: global(),
    });
    expect(guest.find('.rank').exists()).toBe(false);
  });

  test('marks an AI player with the robot that is its avatar, and a player whom an AI plays for', () => {
    const ai = mount(PlayerName, {
      props: {
        player: { id: 'ai', name: 'Reviewer 1', online: true, agent: 'reviewer1' as const },
        me: false,
        chair: false,
      },
      global: global(),
    });
    expect(ai.get('.mark.agent').text()).toBe('AI');
    expect(ai.get('.mark.agent').find('svg').exists()).toBe(true);
    expect(ai.get('.avatar').find('svg').exists()).toBe(true);
    expect(ai.get('.avatar').find('.initial').exists()).toBe(false);
    const played = mount(PlayerName, {
      props: {
        player: { id: 'a', name: 'Ann', online: false, takenOver: true as const },
        me: false,
        chair: false,
      },
      global: global(),
    });
    expect(played.findAll('.mark').map((mark) => mark.text())).toEqual(['AI playing', 'offline']);
    expect(played.get('.avatar').find('svg').exists()).toBe(false);
  });
});

describe('FieldPicker', () => {
  const fields = [
    { id: 'general', name: { zh: 'G', en: 'General' }, counts: { zh: 30, en: 30 } },
    { id: 'small', name: { zh: 'S', en: 'Small' }, counts: { zh: 30, en: 3 } },
  ];

  test('offers only the lists with enough words in the language', async () => {
    const wrapper = mount(FieldPicker, {
      props: { fields, language: 'en', needed: 25, modelValue: [], 'onUpdate:modelValue': () => {} },
      global: global(),
    });
    const boxes = wrapper.findAll('input');
    expect(boxes[0]?.attributes('disabled')).toBeUndefined();
    expect(boxes[1]?.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('30 terms');
    expect(wrapper.text()).toContain('Not enough terms in this language');
    await boxes[0]?.setValue(true);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['general']]);
  });
});

describe('PlayerAvatar', () => {
  test('shows the uploaded picture, and the default when it has none or it fails to load', async () => {
    const wrapper = mount(PlayerAvatar, { props: { name: 'ann', avatar: '/avatars/a.webp' } });
    expect(wrapper.get('img').attributes('src')).toBe('/avatars/a.webp');
    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('.initial').attributes('data-initial')).toBe('A');
    // The initial is drawn, not written: the name beside the avatar is the text.
    expect(wrapper.text()).toBe('');
    // A new picture is tried again.
    await wrapper.setProps({ avatar: '/avatars/b.webp' });
    expect(wrapper.get('img').attributes('src')).toBe('/avatars/b.webp');

    const fallback = mount(PlayerAvatar, { props: { name: 'Bob' } });
    expect(fallback.get('.initial').attributes('data-initial')).toBe('B');
    expect(fallback.attributes('style')).toContain('background');
    expect(fallback.attributes('aria-hidden')).toBe('true');
  });
});

describe('AvatarButton', () => {
  test('is the avatar alone where the page opens no panel, as on a big screen', () => {
    const wrapper = mount(AvatarButton, { props: { playerId: 'b', name: 'Bob' }, global: global() });
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.get('.avatar').attributes('aria-hidden')).toBe('true');
  });

  test("opens the account's panel outside a room, as a room's avatar opens the player's", async () => {
    // The site's one panel (profilePanel.ts), which App.vue holds, here beside the avatar.
    const page = () => h('div', [h(AvatarButton, { handle: 'b0b000000000', name: 'Bob' }), h(ProfilePanel)]);
    const wrapper = mount(page, { global: global(), attachTo: document.body });
    const avatar = wrapper.get('button.avatar-button');
    expect(avatar.attributes('aria-label')).toBe("View Bob's profile");
    expect(avatar.attributes('aria-haspopup')).toBe('dialog');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    (avatar.element as HTMLButtonElement).focus();
    await avatar.trigger('click');
    expect(shownProfile.value).toEqual({ handle: 'b0b000000000', username: 'Bob' });
    await vi.waitFor(() => expect(document.querySelector('[role=dialog] h2')?.textContent?.trim()).toBe('Bob'));
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[role=dialog] button.close')?.click();
    await nextTick();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    // The focus comes back to the avatar.
    expect(document.activeElement).toBe(avatar.element);
    wrapper.unmount();
  });
});

describe('BackButton', () => {
  test('goes back to the page before on the site, and is not there for the first page of a visit', async () => {
    window.history.replaceState({ back: '/room/K7QX' }, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const wrapper = mount(BackButton, { global: global() });
    expect(wrapper.get('button').attributes('aria-label')).toBe('Go back');
    await wrapper.get('button').trigger('click');
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
    window.history.replaceState({ back: null }, '');
    expect(mount(BackButton, { global: global() }).find('button').exists()).toBe(false);
    window.history.replaceState(null, '');
    expect(mount(BackButton, { global: global() }).find('button').exists()).toBe(false);
  });
});

describe('UiSheet', () => {
  // A sheet on the page's body, with three buttons in it, named by a prefix.
  function sheet(title: string, open = false) {
    const buttons = [1, 2, 3].map((n) => h('button', { id: `${title}${n}` }, String(n)));
    return mount(UiSheet, {
      props: { open, title },
      slots: { default: () => buttons },
      global: global(),
      attachTo: document.body,
    });
  }
  const press = (key: string, shiftKey = false) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, cancelable: true }));
  const focus = (id: string) => document.getElementById(id)?.focus();
  const active = () => document.activeElement?.id || document.activeElement?.className;

  test('leaves the keys to the sheet on top when one lies over another', async () => {
    const under = sheet('a');
    const over = sheet('b');
    await under.setProps({ open: true });
    await over.setProps({ open: true });
    await nextTick();
    // Escape closes the one on top only.
    press('Escape');
    expect(under.emitted('close')).toBeUndefined();
    expect(over.emitted('close')).toHaveLength(1);
    // Tab moves on inside the one on top, and wraps at its ends; the one below stays out of it.
    focus('b1');
    press('Tab');
    expect(active()).toBe('b1');
    focus('b3');
    press('Tab');
    expect(active()).toBe('round close');
    press('Tab', true);
    expect(active()).toBe('b3');
    // Once the one on top has gone, the one below takes the keys again.
    await over.setProps({ open: false });
    press('Escape');
    expect(under.emitted('close')).toHaveLength(1);
    under.unmount();
    over.unmount();
  });

  test('has a round button back before its title when it leads back to another', async () => {
    const wrapper = mount(UiSheet, {
      props: { open: true, title: 'Page', back: 'Back' },
      global: global(),
      attachTo: document.body,
    });
    const back = document.querySelector<HTMLButtonElement>('[role=dialog] button.back');
    expect(back?.getAttribute('aria-label')).toBe('Back');
    back?.click();
    expect(wrapper.emitted('back')).toHaveLength(1);
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  test('gives the focus back when it is taken off the page open, as when it is closed', async () => {
    const button = document.createElement('button');
    button.id = 'opener';
    document.body.append(button);
    button.focus();
    const wrapper = sheet('e', true);
    await nextTick();
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
    wrapper.unmount();
    expect(active()).toBe('opener');
    button.remove();
  });

  test('takes the keys and the focus when it is created open', async () => {
    const wrapper = sheet('c', true);
    await nextTick();
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
    press('Escape');
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  // A switch, such as the one for the sounds in the room menu, is armed by the space bar as a
  // button is: the focus goes past it, to a field to type in or else to the panel.
  test('gives the focus to the first field to type in, and never to a checkbox', async () => {
    const open = (inputs: (() => ReturnType<typeof h>)[]) =>
      mount(UiSheet, {
        props: { open: false, title: 'd' },
        slots: { default: () => inputs.map((input) => input()) },
        global: global(),
        attachTo: document.body,
      });
    const checkbox = () => h('input', { type: 'checkbox', id: 'mute' });
    const field = () => h('input', { type: 'text', id: 'name' });
    const switchOnly = open([checkbox]);
    await switchOnly.setProps({ open: true });
    await nextTick();
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
    switchOnly.unmount();
    const withField = open([checkbox, field]);
    await withField.setProps({ open: true });
    await nextTick();
    expect(active()).toBe('name');
    withField.unmount();
  });
});
