// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';

// The list is ACKNOWLEDGMENTS.md as the build bundles it; here, a file made up for the tests.
const file = vi.hoisted(() => ({ default: '' }));
vi.mock('../../../../ACKNOWLEDGMENTS.md?raw', () => file);

const DASH = '\u{2014}';
const FILE = [
  '# Acknowledgments',
  '',
  'We thank the players who helped.',
  '',
  '## Pilot study',
  '',
  `- Bob ${DASH} played the first games`,
  '',
  '## Helpful discussions',
  '',
  `- [Ann L](https://ann.example/) ${DASH} suggested public rooms (#40)`,
  `- An anonymous player ${DASH} reported the reconnect bug (#42, #43)`,
  `- Dr\\. Who ${DASH} found a typo`,
  `- Dr. Who ${DASH} breaks the rules, and is left out`,
].join('\n');

const i18n = (locale: 'en' | 'zh' = 'en') => createI18n({ legacy: false, locale, messages: { en, zh } });

async function mounted(source: string, locale: 'en' | 'zh' = 'en') {
  file.default = source;
  vi.resetModules();
  const { default: List } = await import('./AcknowledgmentsList.vue');
  return mount(List, { global: { plugins: [i18n(locale)] } });
}

describe('the acknowledgments', () => {
  test('show the sections of the file, in its order, under the headings of the interface', async () => {
    const wrapper = await mounted(FILE);
    const groups = wrapper.findAll('section');
    expect(groups.map((group) => group.get('h3').text())).toEqual(['Pilot study', 'Helpful discussions']);
    expect(groups[0]?.findAll('li').map((item) => item.text())).toEqual(['Bob \u{2014} played the first games']);
    expect(groups[1]?.findAll('li').map((item) => item.text())).toEqual([
      'Ann L \u{2014} suggested public rooms (#40)',
      'An anonymous player \u{2014} reported the reconnect bug (#42, #43)',
      'Dr. Who \u{2014} found a typo',
    ]);
  });

  test("link a name to its player's page, as the site's own links are not, and numbers to the repository", async () => {
    const wrapper = await mounted(FILE);
    const ann = wrapper.get('a.name');
    expect(ann.text()).toBe('Ann L');
    expect(ann.attributes()).toMatchObject({
      href: 'https://ann.example/',
      target: '_blank',
      rel: 'nofollow ugc noopener',
    });
    expect(wrapper.findAll('a.name')).toHaveLength(1);
    const issues = wrapper.findAll('.what a');
    expect(issues.map((link) => [link.text(), link.attributes('href')])).toEqual([
      ['#40', 'https://github.com/jxxsteven7/reviewer2/issues/40'],
      ['#42', 'https://github.com/jxxsteven7/reviewer2/issues/42'],
      ['#43', 'https://github.com/jxxsteven7/reviewer2/issues/43'],
    ]);
  });

  test('call the sections and an anonymous player in the language of the page, and leave the rest in English', async () => {
    const wrapper = await mounted(FILE, 'zh');
    // "Acknowledgments" in Chinese.
    expect(wrapper.get('summary').text()).toBe('\u81f4\u8c22');
    // "Pilot study" and "Helpful discussions".
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
      '\u9884\u5b9e\u9a8c',
      '\u6709\u76ca\u7684\u8ba8\u8bba',
    ]);
    // "An anonymous player".
    expect(wrapper.findAll('li')[2]?.text()).toBe(
      '\u4e00\u4f4d\u533f\u540d\u73a9\u5bb6 \u{2014} reported the reconnect bug (#42, #43)',
    );
  });

  test('say so when there is nobody yet', async () => {
    const wrapper = await mounted('# Acknowledgments\n\n_No one yet._\n');
    expect(wrapper.text()).toContain('No one yet. Be the first!');
    expect(wrapper.find('section').exists()).toBe(false);
  });
});
