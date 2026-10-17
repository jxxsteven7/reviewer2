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

// The contributions, as the server answers from its database: the adopted feedback and the adopted
// issues from GitHub, newest first, each with what the operator wrote in both languages: signed
// with an account, by a guest's name, anonymous, signed with an account that is gone, by the GitHub
// username of an issue's author, by nobody for an author who asked to stay anonymous, and a
// security advisory.
const SUMMARY = { zh: '提出了加入 AI 玩家', en: 'Suggested AI players' };
const site = { source: 'site', profile: null, avatar: null, deleted: false, advisory: null } as const;
const github = { source: 'github', profile: null, avatar: null, deleted: false } as const;
const CONTRIBUTIONS: Contribution[] = [
  {
    ...site,
    kind: 'words',
    name: 'Ann',
    profile: 'a1b2c3d4e5f6',
    avatar: '/avatars/ann.webp',
    summary: { zh: '加了词', en: 'Added words' },
    issue: 85,
    month: '2026-11',
  },
  {
    ...github,
    kind: 'bug',
    name: 'hubot',
    summary: { zh: '报了一个安全问题', en: 'Reported a security problem' },
    issue: null,
    advisory: 'GHSA-24fc-5gmw-5x4j',
    month: '2026-11',
  },
  {
    ...site,
    kind: 'bug',
    name: null,
    summary: { zh: '报了 bug', en: 'Reported a bug' },
    issue: 82,
    month: '2026-11',
  },
  {
    ...github,
    kind: 'code',
    name: 'octocat',
    summary: { zh: '整理了测试', en: 'Tidied the tests' },
    issue: 14,
    advisory: null,
    month: '2026-11',
  },
  { ...site, kind: 'idea', name: 'Lizi', summary: SUMMARY, issue: 57, month: '2026-10' },
  {
    ...site,
    kind: 'idea',
    name: null,
    deleted: true,
    summary: { zh: '提出了分组', en: 'Suggested groups' },
    issue: 41,
    month: '2026-10',
  },
  {
    ...github,
    kind: 'idea',
    name: null,
    summary: { zh: '提出了关房', en: 'Suggested closing rooms' },
    issue: 16,
    advisory: null,
    month: '2026-10',
  },
  { ...site, kind: 'idea', name: 'Ann', profile: 'a1b2c3d4e5f6', summary: null, issue: 30, month: '2026-09' },
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
  test('count in their title the people they name, each once for each place they came from, and every anonymous or deleted one', async () => {
    const wrapper = await opened();
    // Ann twice, Lizi, a deleted player and an anonymous one from the site; octocat, hubot and an
    // anonymous author from GitHub.
    expect(wrapper.get('h2').text()).toBe('Feedback contributions · 7 people');
    const intro = wrapper.get('.intro');
    expect(intro.text()).toContain('What is adopted is the idea, and what was built may differ');
    // Those who wrote the code are on GitHub, with an arrow for the way off the site.
    expect(intro.text()).toContain('Those who wrote the code are listed on GitHub.');
    const coders = intro.get('a.coders');
    expect(coders.attributes()).toMatchObject({
      href: 'https://github.com/jxxsteven7/reviewer2/graphs/contributors',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(coders.find('svg.arrow').exists()).toBe(true);
  });

  test('come in a section for each kind that has any, in the order of the kinds, the code last', async () => {
    const wrapper = await opened();
    const groups = wrapper.findAll('section');
    expect(groups.map((group) => group.get('h3').text())).toEqual(['Ideas', 'Bugs', 'Word lists', 'Code']);
    expect(groups.map((group) => group.findAll('li').map((item) => item.text().replace(/\s+/g, ' ')))).toEqual([
      [
        'Lizi — Suggested AI players #57 · 2026-10',
        'A deleted player — Suggested groups #41 · 2026-10',
        'An anonymous player — Suggested closing rooms #16 · 2026-10',
        'Ann #30 · 2026-09',
      ],
      ['hubot — Reported a security problem advisory · 2026-11', 'An anonymous player — Reported a bug #82 · 2026-11'],
      ['Ann — Added words #85 · 2026-11'],
      ['octocat — Tidied the tests #14 · 2026-11'],
    ]);
  });

  test('link the issue or the advisory, and open the panel of an account only with the profile that the server names', async () => {
    const wrapper = await opened();
    const issues = wrapper.findAll('.meta a');
    expect(issues.map((link) => [link.text(), link.attributes('href')])).toEqual([
      ['#57', 'https://github.com/jxxsteven7/reviewer2/issues/57'],
      ['#41', 'https://github.com/jxxsteven7/reviewer2/issues/41'],
      ['#16', 'https://github.com/jxxsteven7/reviewer2/issues/16'],
      ['#30', 'https://github.com/jxxsteven7/reviewer2/issues/30'],
      ['advisory', 'https://github.com/jxxsteven7/reviewer2/security/advisories/GHSA-24fc-5gmw-5x4j'],
      ['#82', 'https://github.com/jxxsteven7/reviewer2/issues/82'],
      ['#85', 'https://github.com/jxxsteven7/reviewer2/issues/85'],
      ['#14', 'https://github.com/jxxsteven7/reviewer2/issues/14'],
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
    // A guest's name, a deleted player and an anonymous one, from either place, are plain text,
    // with no avatar.
    expect(wrapper.findAll('span.name').map((name) => name.text())).toEqual([
      'Lizi',
      'A deleted player',
      'An anonymous player',
      'An anonymous player',
    ]);

    // The site's panel of the account, as an avatar opens it anywhere else (ProfilePanel.vue).
    expect(people[0]?.attributes('aria-haspopup')).toBe('dialog');
    expect(shownProfile.value).toBeNull();
    await people[0]?.trigger('click');
    expect(shownProfile.value).toEqual({ handle: 'a1b2c3d4e5f6', username: 'Ann' });
    wrapper.unmount();
  });

  test("lead to the GitHub page of an issue's author, with GitHub's mark before the username and an arrow after", async () => {
    const wrapper = await opened();
    const authors = wrapper.findAll('a.person.github');
    expect(authors.map((author) => [author.text(), author.attributes('href')])).toEqual([
      ['hubot', 'https://github.com/hubot'],
      ['octocat', 'https://github.com/octocat'],
    ]);
    for (const author of authors) {
      // Off the site, in a new tab, with nothing of the page handed over.
      expect(author.attributes()).toMatchObject({ target: '_blank', rel: 'nofollow ugc noopener' });
      // GitHub's mark, hanging as an avatar does, pressed as a sticker is; the arrow of a link that
      // leads off the site; and nothing of the site's panel.
      expect(author.get('.avatar').classes()).toContain('press-part');
      expect(author.find('.avatar svg path').exists()).toBe(true);
      expect(author.find('.avatar img').exists()).toBe(false);
      expect(author.find('svg.arrow').exists()).toBe(true);
      expect(author.attributes('aria-haspopup')).toBeUndefined();
    }
    await authors[0]?.trigger('click');
    expect(shownProfile.value).toBeNull();
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
    expect(wrapper.get('h2').text()).toContain('7 people');
    await people[0]?.trigger('click');
    expect(shownProfile.value).toEqual({ handle: 'a1b2c3d4e5f6', username: 'Ann' });
    closeProfile();
    wrapper.unmount();
    knowAliases([]);
  });

  test('say what was contributed in the language of the page, and the rest as it is', async () => {
    const wrapper = await opened('zh');
    // "Feedback contributions, 7 people", in Chinese.
    expect(wrapper.get('h2').text()).toBe('反馈贡献 · 7 位');
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['想法', 'Bug', '词库', '代码']);
    expect(wrapper.findAll('.what').map((what) => what.text())).toEqual([
      SUMMARY.zh,
      '提出了分组',
      '提出了关房',
      '报了一个安全问题',
      '报了 bug',
      '加了词',
      '整理了测试',
    ]);
    // "A deleted player" and "An anonymous player", and "advisory".
    expect(wrapper.findAll('.name')[1]?.text()).toBe('已注销玩家');
    expect(wrapper.findAll('.name')[2]?.text()).toBe('一位匿名玩家');
    expect(wrapper.findAll('.meta a')[4]?.text()).toBe('安全公告');
    expect(wrapper.get('.intro').text()).toContain('写代码的贡献者列在 GitHub 上。');
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
    // An entry with an avatar, an account's or GitHub's, keeps a column for it; the others start at
    // the edge.
    expect(items.map((item) => item.get('.entry').classes('hangs'))).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
    ]);
    expect(items.map((item) => item.get('.entry').text().split(/\s/)[0])).toEqual([
      'Lizi',
      'A',
      'An',
      'Ann',
      'hubot',
      'An',
      'Ann',
      'octocat',
    ]);
  });

  test('show names and what was contributed as plain text', async () => {
    fetchMock.mockImplementation(async () =>
      answer([
        {
          kind: 'idea',
          source: 'site',
          name: '<b>Ann</b>',
          profile: null,
          deleted: false,
          summary: { zh: '<i>x</i>', en: '<i>x</i>' },
          issue: 1,
          advisory: null,
          month: '2026-10',
        },
        {
          kind: 'code',
          source: 'github',
          name: '<b>octocat</b>',
          profile: null,
          deleted: false,
          summary: { zh: '<i>y</i>', en: '<i>y</i>' },
          issue: 2,
          advisory: null,
          month: '2026-10',
        },
      ]),
    );
    const wrapper = await opened();
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.find('i').exists()).toBe(false);
    expect(wrapper.get('span.name').text()).toBe('<b>Ann</b>');
    expect(wrapper.get('a.github .text').text()).toBe('<b>octocat</b>');
    expect(wrapper.get('a.github').attributes('href')).toBe('https://github.com/<b>octocat</b>');
    expect(wrapper.findAll('.what').map((what) => what.text())).toEqual(['<i>x</i>', '<i>y</i>']);
  });

  test('say so while nothing has been adopted, with a title of its name alone', async () => {
    fetchMock.mockImplementation(async () => answer([]));
    const wrapper = await opened();
    expect(wrapper.get('h2').text()).toBe('Feedback contributions');
    expect(wrapper.text()).toContain('No feedback has been adopted yet. Be the first!');
    expect(wrapper.find('section').exists()).toBe(false);
  });
});
