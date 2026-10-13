// @vitest-environment happy-dom
import { LIST_API, parseSponsors, SPONSORS_END, SPONSORS_START } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import SponsorsList from './SponsorsList.vue';

// The list is what the server reads from SPONSORS.md; here, the sections of a file made up for the
// tests, which the server answers with.
const FILE = [
  '# Sponsors',
  '',
  SPONSORS_START,
  '## GitHub Sponsors',
  '',
  '- [octocat](https://github.com/octocat)',
  '- [Mona-Lisa](https://github.com/Mona-Lisa)',
  SPONSORS_END,
  '',
  '## Other ways',
  '',
  '- [Ann L](https://ann.example/)',
  '- Dr\\. Who',
].join('\n');

const fetchMock = vi.fn<typeof fetch>();
const answer = (sections: unknown) => new Response(JSON.stringify({ ok: true, sections }), { status: 200 });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => answer(parseSponsors(FILE).sections));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function opened(locale: 'en' | 'zh' = 'en') {
  const i18n = createI18n({ legacy: false, locale, messages: { en, zh } });
  const wrapper = mount(SponsorsList, { global: { plugins: [i18n] } });
  await flushPromises();
  // Asked for once the card is shown, so that its title counts the sponsors, and not again.
  expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([LIST_API.sponsors]);
  await wrapper.get('h2 button').trigger('click');
  await flushPromises();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return wrapper;
}

describe('the sponsors', () => {
  test('are listed by name alone, in the sections of the file, each linked to their page', async () => {
    const wrapper = await opened();
    expect(wrapper.get('h2').text()).toBe('Sponsors \u{b7} 4 people');
    const groups = wrapper.findAll('section');
    expect(groups.map((group) => group.get('h3').text())).toEqual(['GitHub Sponsors', 'Other ways']);
    expect(groups.map((group) => group.findAll('li').map((item) => item.text()))).toEqual([
      ['octocat', 'Mona-Lisa'],
      ['Ann L', 'Dr. Who'],
    ]);
    const links = wrapper.findAll('a.name');
    expect(links.map((link) => link.attributes('href'))).toEqual([
      'https://github.com/octocat',
      'https://github.com/Mona-Lisa',
      'https://ann.example/',
    ]);
    for (const link of links) {
      expect(link.attributes()).toMatchObject({ target: '_blank', rel: 'nofollow ugc noopener' });
    }
  });

  test('call the sections in the language of the page', async () => {
    const wrapper = await opened('zh');
    // "Sponsors", 4 of them, and "Other ways" in Chinese; GitHub Sponsors keeps its name.
    expect(wrapper.get('h2').text()).toBe('\u8d5e\u52a9\u8005 \u00b7 4 \u4f4d');
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
      'GitHub Sponsors',
      '\u5176\u4ed6\u65b9\u5f0f',
    ]);
  });

  test('show a name as plain text, and link it only to an https page', async () => {
    fetchMock.mockImplementation(async () =>
      answer([{ kind: 'other', entries: [{ name: '<i>Ann</i>', link: 'javascript:alert(1)' }] }]),
    );
    const wrapper = await opened();
    expect(wrapper.find('a.name').exists()).toBe(false);
    expect(wrapper.find('i').exists()).toBe(false);
    expect(wrapper.get('li').text()).toBe('<i>Ann</i>');
  });

  test('while there are none, ask for the first, on GitHub Sponsors or with a WeChat tip', async () => {
    fetchMock.mockImplementation(async () => answer([]));
    // The locale files' texts, which the build has compiled where they are imported.
    const texts = {
      en: { github: 'GitHub Sponsors', wechat: 'a WeChat tip' },
      // "Sponsor on GitHub Sponsors" and "with a WeChat tip" in Chinese.
      zh: { github: '\u5728 GitHub Sponsors \u4e0a\u8d5e\u52a9', wechat: '\u7528\u5fae\u4fe1\u8d5e\u8d4f' },
    };
    for (const locale of ['en', 'zh'] as const) {
      const wrapper = await opened(locale);
      const text = texts[locale];
      // The title alone, with nobody to count: "Sponsors" in Chinese.
      expect(wrapper.get('h2').text()).toBe(locale === 'en' ? 'Sponsors' : '\u8d5e\u52a9\u8005');
      expect(wrapper.find('section').exists()).toBe(false);
      const github = wrapper.get('.note a');
      expect(github.text()).toBe(text.github);
      expect(github.attributes()).toMatchObject({
        href: 'https://github.com/sponsors/jxxsteven7',
        target: '_blank',
        rel: 'noopener noreferrer',
      });
      const tip = wrapper.get('.note button');
      expect(tip.text()).toBe(text.wechat);
      await tip.trigger('click');
      expect(wrapper.emitted('tip')).toHaveLength(1);
      fetchMock.mockClear();
    }
  });
});
