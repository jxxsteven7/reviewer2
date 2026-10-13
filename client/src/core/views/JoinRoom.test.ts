// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import JoinRoom from './JoinRoom.vue';

const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  setLanguage('en', { remember: false });
  push.mockReset();
});

// Joining by the manuscript number: the button stands in the field's slot beside the box, so that
// the field keeps its label above both and its error below, and the room page takes a number
// that reads.
describe('joining by number', () => {
  test('puts the button beside the box, in the field', () => {
    const wrapper = mount(JoinRoom, { global: { plugins: [i18n] } });
    const field = wrapper.get('.field');
    expect(field.classes()).toContain('beside');
    expect(field.get('button[type="submit"]').text()).toBe('Join');
  });

  test('goes to the room of a number that reads, and says what a number is otherwise', async () => {
    const wrapper = mount(JoinRoom, { global: { plugins: [i18n] } });
    await wrapper.get('input').setValue('nope!');
    await wrapper.get('form').trigger('submit');
    expect(push).not.toHaveBeenCalled();
    expect(wrapper.get('.field .note.error').text()).toBe('Enter the 4 characters after R2-.');
    await wrapper.get('input').setValue('k7qx');
    await wrapper.get('form').trigger('submit');
    expect(push).toHaveBeenCalledWith('/room/K7QX');
  });
});
