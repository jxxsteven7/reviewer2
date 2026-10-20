// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { spot } from '../guide/spot';
import GuideFinger from './GuideFinger.vue';

// The stage of a chapter: the finger's layer over a scene with a card in it.
const Stage = defineComponent({
  render: () => h('div', { class: 'stage' }, [h(GuideFinger), h('button', { class: 'card' }, 'Black hole')]),
});

afterEach(() => {
  spot.value = null;
  document.body.innerHTML = '';
});

describe('the finger', () => {
  test('taps, holds or points at the part that the step is about, and is gone without one', async () => {
    const wrapper = mount(Stage, { attachTo: document.body });
    expect(wrapper.find('.finger').exists()).toBe(false);
    expect(wrapper.get('.finger-layer').attributes('aria-hidden')).toBe('true');
    const card = wrapper.get('.card').element;

    spot.value = { el: card, finger: 'tap' };
    await nextTick();
    const tapping = wrapper.get('.finger');
    expect(tapping.classes()).toContain('tap');
    expect(tapping.find('.hand').exists()).toBe(true);
    expect(tapping.find('.ripple').exists()).toBe(true);
    expect(tapping.find('.hold-ring').exists()).toBe(false);

    spot.value = { el: card, finger: 'hold' };
    await nextTick();
    expect(wrapper.get('.finger').classes()).toContain('hold');
    expect(wrapper.find('.finger .hold-ring').exists()).toBe(true);

    spot.value = { el: card, finger: 'point' };
    await nextTick();
    expect(wrapper.get('.finger').classes()).toContain('point');

    spot.value = null;
    await nextTick();
    expect(wrapper.find('.finger').exists()).toBe(false);
    wrapper.unmount();
  });

  test('is gone when the part it was at is no longer on the page', async () => {
    const wrapper = mount(Stage, { attachTo: document.body });
    const card = wrapper.get('.card').element;
    card.remove();
    spot.value = { el: card, finger: 'tap' };
    await nextTick();
    expect(wrapper.find('.finger').exists()).toBe(false);
    wrapper.unmount();
  });
});
