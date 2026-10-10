// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import AcknowledgmentsList from './AcknowledgmentsList.vue';

const api = vi.hoisted(() => ({
  request: vi.fn<(path: string) => Promise<{ ok: true; acknowledgments: object[] } | { ok: false; error: string }>>(),
}));
vi.mock('../account', () => api);

const LIST = [
  { name: 'Ann L', kind: 'feedback', date: '2026-10-10' },
  { name: 'Bob', kind: 'playtesting', date: '2026-10-12' },
  { name: 'octocat', kind: 'feedback', date: '2026-10-11' },
];

const i18n = (locale: 'en' | 'zh' = 'en') => createI18n({ legacy: false, locale, messages: { en, zh } });

beforeEach(() => {
  api.request.mockReset();
  api.request.mockResolvedValue({ ok: true, acknowledgments: LIST });
});

// Opens the fold, as a tap on its summary does.
async function open(locale: 'en' | 'zh' = 'en') {
  const wrapper = mount(AcknowledgmentsList, { global: { plugins: [i18n(locale)] } });
  (wrapper.get('details').element as HTMLDetailsElement).open = true;
  await wrapper.get('details').trigger('toggle');
  await flushPromises();
  return wrapper;
}

describe('the acknowledgments', () => {
  test('are fetched when the fold is opened, once, and grouped by kind in the order of the kinds', async () => {
    const closed = mount(AcknowledgmentsList, { global: { plugins: [i18n()] } });
    expect(closed.find('li').exists()).toBe(false);
    expect(api.request).not.toHaveBeenCalled();
    const wrapper = await open();
    expect(api.request).toHaveBeenCalledWith('/api/acknowledgments');
    const groups = wrapper.findAll('section');
    expect(groups.map((group) => group.get('h3').text())).toEqual(['Ideas and bug reports', 'Playtesting']);
    expect(groups[0]?.findAll('li').map((item) => item.text())).toEqual(['Ann LOct 10, 2026', 'octocatOct 11, 2026']);
    expect(groups[1]?.findAll('li').map((item) => item.text())).toEqual(['BobOct 12, 2026']);
    await wrapper.get('details').trigger('toggle');
    expect(api.request).toHaveBeenCalledOnce();
  });

  test('write the day in the language of the page', async () => {
    const wrapper = await open('zh');
    // "Acknowledgments" in Chinese.
    expect(wrapper.get('summary').text()).toBe('\u81f4\u8c22');
    expect(wrapper.get('li').text()).toContain('2026');
    expect(wrapper.get('li').text()).not.toContain('Oct');
  });

  test('say so when there is nobody yet, and when the list could not be fetched', async () => {
    api.request.mockResolvedValue({ ok: true, acknowledgments: [] });
    expect((await open()).text()).toContain('No one yet.');

    api.request.mockResolvedValue({ ok: false, error: 'offline' });
    const wrapper = await open();
    expect(wrapper.get('[role="alert"]').text()).toBe("You're offline. Waiting for the connection...");
    // Opening the fold again tries again.
    api.request.mockResolvedValue({ ok: true, acknowledgments: LIST });
    await wrapper.get('details').trigger('toggle');
    await flushPromises();
    expect(wrapper.findAll('li')).toHaveLength(3);
  });
});
