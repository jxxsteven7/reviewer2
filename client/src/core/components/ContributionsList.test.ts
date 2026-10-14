// @vitest-environment happy-dom
import { type Contribution, CONTRIBUTIONS_API } from '@reviewer2/shared';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import ContributionsList from './ContributionsList.vue';
import ProfileCard from './ProfileCard.vue';

// The feedback contributions, as the server answers from its database: the adopted feedback,
// newest first, each with what the operator wrote in both languages.
const SUMMARY = { zh: '\u63d0\u51fa\u4e86\u52a0\u5165 AI \u73a9\u5bb6', en: 'Suggested AI players' };
const CONTRIBUTIONS: Contribution[] = [
  {
    kind: 'words',
    name: 'Ann',
    profile: 'a1b2c3d4e5f6',
    summary: { zh: '\u52a0\u4e86\u8bcd', en: 'Added words' },
    issue: 85,
    month: '2026-11',
  },
  {
    kind: 'bug',
    name: null,
    profile: null,
    summary: { zh: '\u62a5\u4e86 bug', en: 'Reported a bug' },
    issue: 82,
    month: '2026-11',
  },
  { kind: 'idea', name: 'Lizi', profile: null, summary: SUMMARY, issue: 57, month: '2026-10' },
  { kind: 'idea', name: 'Ann', profile: 'a1b2c3d4e5f6', summary: null, issue: null, month: '2026-09' },
];

const fetchMock = vi.fn<typeof fetch>();
const answer = (contributions: unknown) => new Response(JSON.stringify({ ok: true, contributions }), { status: 200 });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => answer(CONTRIBUTIONS));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function opened(locale: 'en' | 'zh' = 'en') {
  const i18n = createI18n({ legacy: false, locale, messages: { en, zh } });
  const wrapper = mount(ContributionsList, {
    global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub, ProfileCard: true } },
  });
  await flushPromises();
  // Asked for once the card is shown, so that its title counts the players, and not again.
  expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([CONTRIBUTIONS_API]);
  await wrapper.get('h2 button').trigger('click');
  await flushPromises();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return wrapper;
}

describe('the feedback contributions', () => {
  test('count in their title the players they name, each once, and every anonymous one', async () => {
    const wrapper = await opened();
    expect(wrapper.get('h2').text()).toBe('Feedback contributions \u00b7 3 people');
    expect(wrapper.get('.intro').text()).toContain('What is adopted is the idea, and what was built may differ');
  });

  test('come in a section for each kind of feedback that has any, in the order of the kinds', async () => {
    const wrapper = await opened();
    const groups = wrapper.findAll('section');
    expect(groups.map((group) => group.get('h3').text())).toEqual(['Suggestions', 'Bugs', 'Word lists']);
    expect(groups.map((group) => group.findAll('li').map((item) => item.text().replace(/\s+/g, ' ')))).toEqual([
      ['Lizi \u2014 Suggested AI players #57 \u00b7 2026-10', 'Ann 2026-09'],
      ['An anonymous player \u2014 Reported a bug #82 \u00b7 2026-11'],
      ['Ann \u2014 Added words #85 \u00b7 2026-11'],
    ]);
  });

  test('link the issue, and open a card for a name only with the profile that the server names', async () => {
    const wrapper = await opened();
    const issues = wrapper.findAll('.meta a');
    expect(issues.map((link) => [link.text(), link.attributes('href')])).toEqual([
      ['#57', 'https://github.com/jxxsteven7/reviewer2/issues/57'],
      ['#82', 'https://github.com/jxxsteven7/reviewer2/issues/82'],
      ['#85', 'https://github.com/jxxsteven7/reviewer2/issues/85'],
    ]);
    for (const link of issues)
      expect(link.attributes()).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
    const people = wrapper.findAll('button.person');
    expect(people.map((person) => person.text())).toEqual(['Ann', 'Ann']);
    expect(wrapper.findAll('span.name').map((name) => name.text())).toEqual(['Lizi', 'An anonymous player']);
    expect(wrapper.findComponent(ProfileCard).exists()).toBe(false);

    // A sheet over the page, titled with the name, with the brief card and the way to the page.
    await people[0]?.trigger('click');
    const dialog = document.querySelector('[role=dialog]');
    expect(dialog?.textContent).toContain('Ann');
    expect(wrapper.findComponent(ProfileCard).props()).toMatchObject({ handle: 'a1b2c3d4e5f6', brief: true });
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/p/a1b2c3d4e5f6');
    // vue-i18n compiles the imported messages in place, so the text is written out.
    expect(dialog?.textContent).toContain('Open the full page');
    wrapper.unmount();
  });

  test('say what was contributed in the language of the page, and the rest as it is', async () => {
    const wrapper = await opened('zh');
    // "Feedback contributions, 3 people", in Chinese.
    expect(wrapper.get('h2').text()).toBe('\u53cd\u9988\u8d21\u732e \u00b7 3 \u4f4d');
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['\u5efa\u8bae', 'Bug', '\u8bcd\u5e93']);
    expect(wrapper.findAll('.what').map((what) => what.text())).toEqual([
      SUMMARY.zh,
      '\u62a5\u4e86 bug',
      '\u52a0\u4e86\u8bcd',
    ]);
    // "An anonymous player".
    expect(wrapper.findAll('.name')[2]?.text()).toBe('\u4e00\u4f4d\u533f\u540d\u73a9\u5bb6');
  });

  test('show names and what was contributed as plain text', async () => {
    fetchMock.mockImplementation(async () =>
      answer([
        {
          kind: 'idea',
          name: '<b>Ann</b>',
          profile: null,
          summary: { zh: '<i>x</i>', en: '<i>x</i>' },
          issue: 1,
          month: '2026-10',
        },
      ]),
    );
    const wrapper = await opened();
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.find('i').exists()).toBe(false);
    expect(wrapper.get('.name').text()).toBe('<b>Ann</b>');
    expect(wrapper.get('.what').text()).toBe('<i>x</i>');
  });

  test('say so while nothing has been adopted, with a title of its name alone', async () => {
    fetchMock.mockImplementation(async () => answer([]));
    const wrapper = await opened();
    expect(wrapper.get('h2').text()).toBe('Feedback contributions');
    expect(wrapper.text()).toContain('No feedback has been adopted yet. Be the first!');
    expect(wrapper.find('section').exists()).toBe(false);
  });
});
