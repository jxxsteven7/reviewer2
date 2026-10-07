// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import FieldPicker from './FieldPicker.vue';
import PlayerName from './PlayerName.vue';

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
