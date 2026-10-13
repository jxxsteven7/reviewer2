// @vitest-environment happy-dom
import { LIST_API, parseAcknowledgments } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import AcknowledgmentsList from './AcknowledgmentsList.vue';

// The list is what the server reads from ACKNOWLEDGMENTS.md; here, the sections of a file made up
// for the tests, which the server answers with.
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
].join('\n');

const fetchMock = vi.fn<typeof fetch>();
const answer = (sections: unknown) => new Response(JSON.stringify({ ok: true, sections }), { status: 200 });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => answer(parseAcknowledgments(FILE).sections));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const i18n = (locale: 'en' | 'zh' = 'en') => createI18n({ legacy: false, locale, messages: { en, zh } });

// The card as the page shows it, once the server has answered, and opened as a player opens it.
async function shown(locale: 'en' | 'zh' = 'en') {
  const wrapper = mount(AcknowledgmentsList, { global: { plugins: [i18n(locale)] } });
  await flushPromises();
  return wrapper;
}
async function opened(locale: 'en' | 'zh' = 'en') {
  const wrapper = await shown(locale);
  await toggle(wrapper);
  return wrapper;
}
async function toggle(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('h2 button').trigger('click');
  await flushPromises();
}

// "Acknowledgments", with how many people the list names.
const title = (people: string) => `Acknowledgments \u{b7} ${people}`;

describe('the acknowledgments', () => {
  test('are asked for once, when the card is shown, which stays folded until it is opened', async () => {
    const wrapper = await shown();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(LIST_API.acknowledgments);
    const button = wrapper.get('h2 button');
    const panel = wrapper.get(`[id="${button.attributes('aria-controls')}"]`).element as HTMLElement;
    const folded = () => panel.style.display === 'none';
    expect(button.attributes('aria-expanded')).toBe('false');
    expect(folded()).toBe(true);
    await toggle(wrapper);
    expect(button.attributes('aria-expanded')).toBe('true');
    expect(folded()).toBe(false);
    await toggle(wrapper);
    expect(button.attributes('aria-expanded')).toBe('false');
    expect(folded()).toBe(true);
    await toggle(wrapper);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('count in their title the people they name, each once, and every anonymous player', async () => {
    expect((await shown()).get('h2').text()).toBe(title('4 people'));
    const ann = { name: 'Ann', link: null, contribution: 'tested' };
    const anonymous = { name: null, link: null, contribution: 'tested' };
    fetchMock.mockImplementation(async () =>
      answer([
        { kind: 'feedback', entries: [ann, anonymous] },
        { kind: 'playtesting', entries: [ann, anonymous] },
      ]),
    );
    expect((await shown()).get('h2').text()).toBe(title('3 people'));
    fetchMock.mockImplementation(async () => answer([{ kind: 'feedback', entries: [ann] }]));
    expect((await shown()).get('h2').text()).toBe(title('1 person'));
  });

  test('show the sections of the file, in its order, under the headings of the interface', async () => {
    const wrapper = await opened();
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
    const wrapper = await opened();
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

  test('show a name as plain text, and link it only to an https page', async () => {
    fetchMock.mockImplementation(async () =>
      answer([
        {
          kind: 'feedback',
          entries: [
            { name: '<b>Ann</b>', link: 'javascript:alert(1)', contribution: 'tested' },
            { name: 'Bob', link: 'http://bob.example/', contribution: 'tested' },
          ],
        },
      ]),
    );
    const wrapper = await opened();
    expect(wrapper.findAll('a')).toHaveLength(0);
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual([
      '<b>Ann</b> \u{2014} tested',
      'Bob \u{2014} tested',
    ]);
  });

  test('call the sections and an anonymous player in the language of the page, and leave the rest in English', async () => {
    const wrapper = await opened('zh');
    // "Acknowledgments", by 4 people, in Chinese.
    expect(wrapper.get('h2').text()).toBe('\u81f4\u8c22 \u00b7 4 \u4f4d');
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
    fetchMock.mockImplementation(async () => answer([]));
    const wrapper = await opened();
    expect(wrapper.get('h2').text()).toBe('Acknowledgments');
    expect(wrapper.text()).toContain('No one yet. Be the first!');
    expect(wrapper.find('section').exists()).toBe(false);
  });

  test('say that they are loading, and when they could not be, and try again', async () => {
    let answered: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answered = resolve)));
    const wrapper = await opened();
    expect(wrapper.text()).toContain('Loading the list');
    answered(new Response('Bad gateway', { status: 502 }));
    await flushPromises();
    expect(wrapper.text()).toContain("The list couldn't be loaded.");
    expect(wrapper.get('h2').text()).toBe('Acknowledgments');
    await wrapper.get('.failed button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain("The list couldn't be loaded.");
    expect(wrapper.findAll('li')).toHaveLength(4);
    expect(wrapper.get('h2').text()).toBe(title('4 people'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('are asked for again when the card is opened after they could not be loaded', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('Bad gateway', { status: 502 }));
    const wrapper = await shown();
    expect(wrapper.get('h2').text()).toBe('Acknowledgments');
    await toggle(wrapper);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('li')).toHaveLength(4);
  });
});
