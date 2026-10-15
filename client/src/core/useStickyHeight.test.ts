// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { useStickyHeight } from './useStickyHeight';

// A ResizeObserver whose measurements the test makes up: it keeps what it observes, and `resize`
// reports a height for it, as the browser would after a layout.
const observers: FakeObserver[] = [];
class FakeObserver {
  observed = new Set<Element>();
  constructor(private readonly report: (entries: { target: Element }[]) => void) {
    observers.push(this);
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
  resize(target: Element, height: number) {
    Object.defineProperty(target, 'offsetHeight', { value: height, configurable: true });
    this.report([{ target }]);
  }
}

const Bar = defineComponent({
  props: { shown: { type: Boolean, required: true } },
  setup(props) {
    const bar = ref<HTMLElement | null>(null);
    useStickyHeight(bar);
    // A button before the bar, as the masthead's; the bar, with a button of its own; and the fields
    // of the page after it.
    return () =>
      h('div', [
        h('button', { class: 'before' }),
        props.shown ? h('div', { ref: bar, class: 'bar' }, [h('button', { class: 'own' })]) : null,
        h('input', { class: 'field' }),
      ]);
  },
});

// Puts an element where the test says it is on the screen.
const place = (element: Element, top: number, height: number) => {
  element.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect;
};

const stickyHeight = () => document.documentElement.style.getPropertyValue('--sticky-height');

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--sticky-height');
});

describe('useStickyHeight', () => {
  test('puts the height of the bar on the root as it is measured, and takes it off with the bar', async () => {
    const wrapper = mount(Bar, { props: { shown: true }, attachTo: document.body });
    await nextTick();
    const observer = observers[0];
    if (!observer) throw new Error('nothing observes the bar');
    const bar = wrapper.get('.bar').element;
    expect(observer.observed.has(bar)).toBe(true);
    expect(stickyHeight()).toBe('');
    observer.resize(bar, 124);
    expect(stickyHeight()).toBe('124px');
    observer.resize(bar, 180);
    expect(stickyHeight()).toBe('180px');

    // The bar goes, as the chair's does when a match is over: so does the property.
    await wrapper.setProps({ shown: false });
    await nextTick();
    expect(observer.observed.size).toBe(0);
    expect(stickyHeight()).toBe('');

    await wrapper.setProps({ shown: true });
    await nextTick();
    observer.resize(wrapper.get('.bar').element, 52);
    expect(stickyHeight()).toBe('52px');
    wrapper.unmount();
    expect(stickyHeight()).toBe('');
  });

  // WebKit scrolls a field that takes the focus into view only when it is out of the viewport; one
  // under the bar, in the viewport, it leaves there.
  test('scrolls a field that takes the focus out from under the bar, and nothing else', async () => {
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const wrapper = mount(Bar, { props: { shown: true }, attachTo: document.body });
    await nextTick();
    const bar = wrapper.get('.bar').element;
    const field = wrapper.get<HTMLInputElement>('.field').element;
    place(bar, 64, 124);
    const focus = (element: Element) => element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // Under the bar: by how far the bar reaches over it.
    place(field, 35, 40);
    focus(field);
    expect(scrollBy).toHaveBeenCalledWith({ top: -153, behavior: 'instant' });
    // Above the viewport, where the browser scrolled for a field taller than the room below the bar.
    scrollBy.mockClear();
    place(field, -129, 300);
    focus(field);
    expect(scrollBy).toHaveBeenCalledWith({ top: -317, behavior: 'instant' });
    // Below the bar, as the scroll padding puts it: nothing to do.
    scrollBy.mockClear();
    place(field, 188, 40);
    focus(field);
    expect(scrollBy).not.toHaveBeenCalled();
    // The bar's own button and one before the bar on the page can't be under it.
    for (const other of ['.own', '.before']) {
      const button = wrapper.get(other).element;
      place(button, 10, 44);
      focus(button);
    }
    expect(scrollBy).not.toHaveBeenCalled();
    // Nothing once the bar is gone, or the page.
    await wrapper.setProps({ shown: false });
    await nextTick();
    place(field, 35, 40);
    focus(field);
    expect(scrollBy).not.toHaveBeenCalled();
    wrapper.unmount();
    document.body.append(field);
    focus(field);
    expect(scrollBy).not.toHaveBeenCalled();
    field.remove();
  });

  test('leaves the stylesheet to guess in a browser without ResizeObserver', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const wrapper = mount(Bar, { props: { shown: true }, attachTo: document.body });
    await nextTick();
    expect(observers).toHaveLength(0);
    expect(stickyHeight()).toBe('');
    wrapper.unmount();
  });
});
