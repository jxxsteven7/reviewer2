// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import MarkMenu from './MarkMenu.vue';

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });

// A card on the board, where the test says it is on the screen.
function cardAt(box: { left: number; top: number }) {
  const card = document.createElement('button');
  card.className = 'card';
  card.innerHTML = '<span class="word">Model</span>';
  document.body.append(card);
  const place = { ...box, width: 60, height: 40 };
  card.getBoundingClientRect = () =>
    ({
      ...place,
      right: place.left + place.width,
      bottom: place.top + place.height,
      x: place.left,
      y: place.top,
    }) as DOMRect;
  return { card, place };
}

describe('MarkMenu', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  // The page can move while the menu is open, as when a finger drags it, or when a clue puts a line
  // above the board, and the board can be laid out anew, as when the phone is turned: the card lands
  // where the card on the board is now, at its size.
  test('lands the lifted card where the card on the board is as the menu closes, at its size', async () => {
    const { card, place } = cardAt({ left: 100, top: 300 });
    const wrapper = mount(MarkMenu, {
      props: { source: card, word: 'Model', current: null, team: 'red' },
      global: { plugins: [i18n()], stubs: { teleport: true } },
      attachTo: document.body,
    });
    await flushPromises();
    const lifted = () => wrapper.get<HTMLElement>('.lifted').element.style;
    const box = () => [lifted().left, lifted().top, lifted().width, lifted().height];
    expect(box()).toEqual(['100px', '300px', '60px', '40px']);
    place.top = 210;
    place.width = 72;
    place.height = 48;
    vi.useFakeTimers();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(box()).toEqual(['100px', '210px', '72px', '48px']);
    // The card on the board shows again once the lifted one has landed.
    expect(wrapper.emitted('close')).toBeUndefined();
    vi.advanceTimersByTime(300);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  test('lets the card on the board show again as soon as the lifted one has landed', async () => {
    const { card } = cardAt({ left: 100, top: 300 });
    const wrapper = mount(MarkMenu, {
      props: { source: card, word: 'Model', current: null, team: 'red' },
      global: { plugins: [i18n()], stubs: { teleport: true } },
      attachTo: document.body,
    });
    await flushPromises();
    vi.useFakeTimers();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    // The menu's own fade ends nothing; the lifted card's move does.
    wrapper.get('.menu').element.dispatchEvent(new Event('transitionend', { bubbles: true }));
    expect(wrapper.emitted('close')).toBeUndefined();
    const landed = new Event('transitionend', { bubbles: true });
    Object.assign(landed, { propertyName: 'transform' });
    wrapper.get('.lifted').element.dispatchEvent(landed);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
