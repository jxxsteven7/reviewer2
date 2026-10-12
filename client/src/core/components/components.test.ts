// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import FieldPicker from './FieldPicker.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import PlayerName from './PlayerName.vue';
import UiSheet from './UiSheet.vue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });
const global = () => ({ plugins: [i18n()] });

describe('PlayerName', () => {
  test('marks the viewer, the chair and offline players', () => {
    const wrapper = mount(PlayerName, {
      props: { player: { id: 'a', name: 'Ann', online: false }, me: true, chair: true, manageable: false },
      global: global(),
    });
    expect(wrapper.text()).toContain('Ann');
    expect(wrapper.text()).toContain('you');
    expect(wrapper.text()).toContain('chair');
    expect(wrapper.text()).toContain('offline');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  test('is a button for the chair, which reports the player', async () => {
    const player = { id: 'b', name: 'Bob', online: true };
    const wrapper = mount(PlayerName, {
      props: { player, me: false, chair: false, manageable: true },
      global: global(),
    });
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('manage')).toEqual([[player]]);
  });

  test('shows the academic rank of a player with an account, and none for a guest', () => {
    const ranked = mount(PlayerName, {
      props: {
        player: { id: 'a', name: 'Ann', online: true, rank: 'phd' as const },
        me: false,
        chair: false,
        manageable: false,
      },
      global: global(),
    });
    expect(ranked.find('.rank').text()).toBe('PhD student');
    const guest = mount(PlayerName, {
      props: { player: { id: 'b', name: 'Bob', online: true }, me: false, chair: false, manageable: false },
      global: global(),
    });
    expect(guest.find('.rank').exists()).toBe(false);
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
    expect(active()).toBe('close');
    press('Tab', true);
    expect(active()).toBe('b3');
    // Once the one on top has gone, the one below takes the keys again.
    await over.setProps({ open: false });
    press('Escape');
    expect(under.emitted('close')).toHaveLength(1);
    under.unmount();
    over.unmount();
  });

  test('takes the keys and the focus when it is created open', async () => {
    const wrapper = sheet('c', true);
    await nextTick();
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
    press('Escape');
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});
