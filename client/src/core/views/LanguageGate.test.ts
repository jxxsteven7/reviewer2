// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test } from 'vitest';
import { i18n, setLanguage, storedLanguage } from '../i18n';
import LanguageGate from './LanguageGate.vue';

const stubs = { SiteWordmark: true };

afterEach(() => setLanguage('en', { remember: false }));

// The gate's two choices are links to the home page in each language, for crawlers, which keep no
// choice; a visitor's click, or space bar, chooses here, as the buttons they look like would.
describe('the language gate', () => {
  test('links to the home page in each language, and a click chooses here, without following the link', () => {
    const gate = mount(LanguageGate, { global: { plugins: [i18n], stubs } });
    expect(gate.findAll('a.choice').map((choice) => choice.attributes('href'))).toEqual(['/?lang=zh', '/?lang=en']);
    const click = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    gate.get('a[href="/?lang=zh"]').element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(gate.emitted('chosen')).toEqual([['zh']]);
    expect(i18n.global.locale.value).toBe('zh');
    expect(storedLanguage()).toBe('zh');
  });

  test('leaves a click that asks for a new tab or window to the link', () => {
    const gate = mount(LanguageGate, { global: { plugins: [i18n], stubs } });
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      const click = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...init });
      gate.get('a[href="/?lang=en"]').element.dispatchEvent(click);
      expect(click.defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(gate.emitted('chosen')).toBeUndefined();
  });

  test('chooses on the space bar too, as a button would, and lets other keys be', () => {
    const gate = mount(LanguageGate, { global: { plugins: [i18n], stubs } });
    const choice = gate.get('a[href="/?lang=en"]').element;
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    choice.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(gate.emitted('chosen')).toBeUndefined();
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    choice.dispatchEvent(space);
    // The page doesn't scroll, as a space on a link would make it.
    expect(space.defaultPrevented).toBe(true);
    expect(gate.emitted('chosen')).toEqual([['en']]);
  });
});
