// @vitest-environment happy-dom
import { type Contribution, CONTRIBUTIONS_API } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import { knowAliases } from '../names';
import { closeProfile, shownProfile } from '../profilePanel';
import ContributionsList from './ContributionsList.vue';

// The feedback contributions, as the server answers from its database: the adopted feedback,
// newest first, each with what the operator wrote in both languages: signed with an account, by a
// guest's name, anonymous, or signed with an account that is gone.
const SUMMARY = { zh: '\u63d0\u51fa\u4e86\u52a0\u5165 AI \u73a9\u5bb6', en: 'Suggested AI players' };
const CONTRIBUTIONS: Contribution[] = [
  {
    kind: 'words',
    name: 'Ann',
    profile: 'a1b2c3d4e5f6',
    avatar: '/avatars/ann.webp',
    deleted: false,
    summary: { zh: '\u52a0\u4e86\u8bcd', en: 'Added words' },
    issue: 85,
    month: '2026-11',
  },
  {
    kind: 'bug',
    name: null,
    profile: null,
    avatar: null,
    deleted: false,
    summary: { zh: '\u62a5\u4e86 bug', en: 'Reported a bug' },
    issue: 82,
    month: '2026-11',
  },
  {
    kind: 'idea',
    name: 'Lizi',
    profile: null,
    avatar: null,
    deleted: false,
    summary: SUMMARY,
    issue: 57,
    month: '2026-10',
  },
  {
    kind: 'idea',
    name: null,
    profile: null,
    avatar: null,
    deleted: true,
    summary: { zh: '\u63d0\u51fa\u4e86\u5206\u7ec4', en: 'Suggested groups' },
    issue: 41,
    month: '2026-10',
  },
  {
    kind: 'idea',
    name: 'Ann',
    profile: 'a1b2c3d4e5f6',
    avatar: null,
    deleted: false,
    summary: null,
    issue: 30,
    month: '2026-09',
  },
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
  closeProfile();
});

async function opened(locale: 'en' | 'zh' = 'en') {
  const i18n = createI18n({ legacy: false, locale, messages: { en, zh } });
  const wrapper = mount(ContributionsList, { global: { plugins: [i18n] } });
  await flushPromises();
  // Asked for once the card is shown, so that its title counts the players, and not again.
  expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([CONTRIBUTIONS_API]);
  await wrapper.get('h2 button').trigger('click');
  await flushPromises();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return wrapper;
}

describe('the feedback contributions', () => {
  test('count in their title the players they name, each once, and every anonymous or deleted one', async () => {
    const wrapper = await opened();
    expect(wrapper.get('h2').text()).toBe('Feedback contributions \u00b7 4 people');
    expect(wrapper.get('.intro').text()).toContain('What is adopted is the idea, and what was built may differ');
  });

  test('come in a section for each kind of feedback that has any, in the order of the kinds', async () => {
    const wrapper = await opened();
    const groups = wrapper.findAll('section');
    expect(groups.map((group) => group.get('h3').text())).toEqual(['Suggestions', 'Bugs', 'Word lists']);
    expect(groups.map((group) => group.findAll('li').map((item) => item.text().replace(/\s+/g, ' ')))).toEqual([
      [
        'Lizi \u2014 Suggested AI players #57 \u00b7 2026-10',
        'A deleted player \u2014 Suggested groups #41 \u00b7 2026-10',
        'Ann #30 \u00b7 2026-09',
      ],
      ['An anonymous player \u2014 Reported a bug #82 \u00b7 2026-11'],
      ['Ann \u2014 Added words #85 \u00b7 2026-11'],
    ]);
  });

  test('link the issue, and open the panel of an account only with the profile that the server names', async () => {
    const wrapper = await opened();
    const issues = wrapper.findAll('.meta a');
    expect(issues.map((link) => [link.text(), link.attributes('href')])).toEqual([
      ['#57', 'https://github.com/jxxsteven7/reviewer2/issues/57'],
      ['#41', 'https://github.com/jxxsteven7/reviewer2/issues/41'],
      ['#30', 'https://github.com/jxxsteven7/reviewer2/issues/30'],
      ['#82', 'https://github.com/jxxsteven7/reviewer2/issues/82'],
      ['#85', 'https://github.com/jxxsteven7/reviewer2/issues/85'],
    ]);
    for (const link of issues)
      expect(link.attributes()).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
    const people = wrapper.findAll('button.person');
    expect(people.map((person) => person.text())).toEqual(['Ann', 'Ann']);
    // Each with the account's avatar before the username: the picture uploaded, or the default.
    const pictures = people.map((person) => person.find('.avatar img'));
    expect(pictures.map((picture) => (picture.exists() ? picture.attributes('src') : null))).toEqual([
      null,
      '/avatars/ann.webp',
    ]);
    expect(people.every((person) => person.find('.avatar').exists())).toBe(true);
    expect(wrapper.findAll('span.name .avatar')).toHaveLength(0);
    // A guest's name, a deleted player and an anonymous one are plain text, with no avatar.
    expect(wrapper.findAll('span.name').map((name) => name.text())).toEqual([
      'Lizi',
      'A deleted player',
      'An anonymous player',
    ]);

    // The site's panel of the account, as an avatar opens it anywhere else (ProfilePanel.vue).
    expect(people[0]?.attributes('aria-haspopup')).toBe('dialog');
    expect(shownProfile.value).toBeNull();
    await people[0]?.trigger('click');
    expect(shownProfile.value).toEqual({ handle: 'a1b2c3d4e5f6', username: 'Ann' });
    wrapper.unmount();
  });

  // An account that the viewer gives a name as a friend goes by it (names.ts), with its own avatar
  // still, and its panel opens on the account.
  test("name a friend by the viewer's name for them", async () => {
    knowAliases([{ handle: 'a1b2c3d4e5f6', alias: 'Prof. A' }]);
    const wrapper = await opened();
    const people = wrapper.findAll('button.person');
    expect(people.map((person) => person.text())).toEqual(['Prof. A', 'Prof. A']);
    expect(people[0]?.get('.initial').attributes('data-initial')).toBe('A');
    // The heading counts people, not names.
    expect(wrapper.get('h2').text()).toContain('4 people');
    await people[0]?.trigger('click');
    expect(shownProfile.value).toEqual({ handle: 'a1b2c3d4e5f6', username: 'Ann' });
    closeProfile();
    wrapper.unmount();
    knowAliases([]);
  });

  test('say what was contributed in the language of the page, and the rest as it is', async () => {
    const wrapper = await opened('zh');
    // "Feedback contributions, 4 people", in Chinese.
    expect(wrapper.get('h2').text()).toBe('\u53cd\u9988\u8d21\u732e \u00b7 4 \u4f4d');
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['\u5efa\u8bae', 'Bug', '\u8bcd\u5e93']);
    expect(wrapper.findAll('.what').map((what) => what.text())).toEqual([
      SUMMARY.zh,
      '\u63d0\u51fa\u4e86\u5206\u7ec4',
      '\u62a5\u4e86 bug',
      '\u52a0\u4e86\u8bcd',
    ]);
    // "A deleted player" and "An anonymous player".
    expect(wrapper.findAll('.name')[1]?.text()).toBe('\u5df2\u6ce8\u9500\u73a9\u5bb6');
    expect(wrapper.findAll('.name')[3]?.text()).toBe('\u4e00\u4f4d\u533f\u540d\u73a9\u5bb6');
  });

  test('keep what follows the name in one piece, the dash with it, which wraps under itself, and hang the avatar', async () => {
    const wrapper = await opened();
    const items = wrapper.findAll('li');
    // Every entry: who, then the rest as one piece, which goes to a line of its own after a long
    // name: the dash, when there is a sentence, and what follows it, which wraps under itself.
    for (const item of items) {
      const rest = item.get('.entry > .rest');
      expect(rest.get('.said').find('.meta').exists()).toBe(true);
      expect(rest.find('.dash').exists()).toBe(item.find('.what').exists());
      expect(item.findAll('.entry > .dash')).toHaveLength(0);
    }
    // An entry with an avatar keeps a column for it; the others start at the edge.
    expect(items.map((item) => item.get('.entry').classes('hangs'))).toEqual([false, false, true, false, true]);
    expect(items.map((item) => item.get('.entry').text().split(/\s/)[0])).toEqual(['Lizi', 'A', 'Ann', 'An', 'Ann']);
  });

  test('show names and what was contributed as plain text', async () => {
    fetchMock.mockImplementation(async () =>
      answer([
        {
          kind: 'idea',
          name: '<b>Ann</b>',
          profile: null,
          deleted: false,
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
