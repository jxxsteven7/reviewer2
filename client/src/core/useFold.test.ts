// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, Transition, vShow, withDirectives } from 'vue';
import { useFold } from './useFold';

// How a fold's height moves (useFold.ts). The layout is the test's own: a part is as tall as its
// own style says, or, with no height of its own, as tall as its content takes.
describe('useFold', () => {
  let takes = 50;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const own = this instanceof HTMLElement ? this.style.height : '';
      const height = own === '' ? takes : parseFloat(own);
      return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: height, width: 100, height, toJSON: () => ({}) };
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('eases a part open to the height its content takes, and on to a new height if the content grew meanwhile', async () => {
    const open = ref(false);
    const wrapper = mount(
      defineComponent({
        setup() {
          const fold = useFold();
          return () =>
            h(Transition, { css: false, ...fold }, () =>
              withDirectives(h('div', { class: 'part' }), [[vShow, open.value]]),
            );
        },
      }),
      { global: { stubs: { transition: false } }, attachTo: document.body },
    );
    const part = wrapper.get('.part').element as HTMLElement;
    open.value = true;
    await nextTick();
    expect(part.style.height).toBe('50px');
    expect(part.style.overflow).toBe('hidden');
    // The list comes while the part is still opening to the height of its loading note.
    takes = 120;
    vi.advanceTimersByTime(300);
    expect(part.style.height).toBe('120px');
    expect(part.style.overflow).toBe('hidden');
    vi.advanceTimersByTime(300);
    expect(part.style.height).toBe('');
    expect(part.style.overflow).toBe('');
    wrapper.unmount();
  });
});
