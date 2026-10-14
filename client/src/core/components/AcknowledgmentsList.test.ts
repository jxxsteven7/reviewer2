// @vitest-environment happy-dom
import { LIST_API, parseAcknowledgments } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import zh from '../../locales/zh.json';
import AcknowledgmentsList from './AcknowledgmentsList.vue';

// The card is what the server reads from ACKNOWLEDGMENTS.md; here, the blocks of a file made up
// for the tests, which the server answers with.
const FRIENDS = '\u670b\u53cb\u4eec'; // "Friends", in Chinese, as the maintainers may write it
const FILE = [
  '# Acknowledgments',
  '<!-- For GitHub alone. -->',
  '',
  `## ${FRIENDS}`,
  '',
  'Reviewer 2 began with **five friends**, who played',
  'the *very* first games.',
  '',
  '### Pilot study',
  '',
  '- [Ann L](https://ann.example/) tested on her phone',
  '- Dr\\. Who found a typo',
].join('\n');

const fetchMock = vi.fn<typeof fetch>();
const answer = (blocks: unknown) => new Response(JSON.stringify({ ok: true, blocks }), { status: 200 });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => answer(parseAcknowledgments(FILE).blocks));
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

  test('have a title of their name alone, which counts nobody, in the language of the page', async () => {
    expect((await shown()).get('h2').text()).toBe('Acknowledgments');
    // "Acknowledgments", in Chinese.
    expect((await shown('zh')).get('h2').text()).toBe('\u81f4\u8c22');
  });

  test('show the file as it is written, headings, paragraphs, lists, bold, italic and links', async () => {
    const wrapper = await opened();
    expect(wrapper.find('.intro').exists()).toBe(false);
    expect(wrapper.get('h3').text()).toBe(FRIENDS);
    expect(wrapper.get('h4').text()).toBe('Pilot study');
    expect(wrapper.get('.list > p').text()).toBe(
      'Reviewer 2 began with five friends, who played the very first games.',
    );
    expect(wrapper.get('strong').text()).toBe('five friends');
    expect(wrapper.get('em').text()).toBe('very');
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual([
      'Ann L tested on her phone',
      'Dr. Who found a typo',
    ]);
    const link = wrapper.get('li a');
    expect(link.text()).toBe('Ann L');
    expect(link.attributes()).toMatchObject({
      href: 'https://ann.example/',
      target: '_blank',
      rel: 'nofollow ugc noopener',
    });
    // The title and the comment are for GitHub alone.
    expect(wrapper.text()).not.toContain('# Acknowledgments');
    expect(wrapper.text()).not.toContain('For GitHub alone');
  });

  test('show what they are sent as plain text, and link only to an https page', async () => {
    fetchMock.mockImplementation(async () =>
      answer([
        {
          kind: 'paragraph',
          pieces: [
            { kind: 'text', text: '<b>Ann</b> ' },
            { kind: 'link', text: 'here', href: 'javascript:alert(1)' },
            { kind: 'text', text: ' and ' },
            { kind: 'link', text: 'there', href: 'http://bob.example/' },
          ],
        },
      ]),
    );
    const wrapper = await opened();
    expect(wrapper.findAll('a')).toHaveLength(0);
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.get('.list > p').text()).toBe('<b>Ann</b> here and there');
  });

  test('say so when there is nothing yet', async () => {
    fetchMock.mockImplementation(async () => answer([]));
    const wrapper = await opened();
    expect(wrapper.get('h2').text()).toBe('Acknowledgments');
    expect(wrapper.text()).toContain('Nothing here yet.');
  });

  test('say that they are loading, and when they could not be, and try again', async () => {
    let answered: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (answered = resolve)));
    const wrapper = await opened();
    expect(wrapper.text()).toContain('Loading the list');
    answered(new Response('Bad gateway', { status: 502 }));
    await flushPromises();
    expect(wrapper.text()).toContain("The list couldn't be loaded.");
    await wrapper.get('.failed button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain("The list couldn't be loaded.");
    expect(wrapper.findAll('li')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('are asked for again when the card is opened after they could not be loaded', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('Bad gateway', { status: 502 }));
    const wrapper = await shown();
    await toggle(wrapper);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('li')).toHaveLength(2);
  });
});
