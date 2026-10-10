// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import { toasts } from '../toast';
import SendFeedback from './SendFeedback.vue';

const socket = vi.hoisted(() => ({
  send: vi.fn<(event: string, payload?: object) => Promise<{ ok: true } | { ok: false; error: string }>>(),
  connect: vi.fn(),
}));
vi.mock('../socket', () => socket);

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });
// The sheet is teleported to the page's body; rendering it in place keeps it inside the wrapper.
const global = () => ({ plugins: [i18n()], stubs: { teleport: true } });

beforeEach(() => {
  socket.send.mockReset();
  socket.send.mockResolvedValue({ ok: true });
  socket.connect.mockReset();
  toasts.splice(0);
});

async function opened(page: 'home' | 'room' = 'home') {
  const wrapper = mount(SendFeedback, { props: { page }, global: global() });
  await wrapper.get('button').trigger('click');
  return wrapper;
}

type Panel = Awaited<ReturnType<typeof opened>>;
const submit = (wrapper: Panel) => wrapper.get('form button[type="submit"]');
// The text field with this label.
const field = (wrapper: Panel, label: string) =>
  wrapper
    .findAll('.field')
    .find((item) => item.get('label').text() === label)
    ?.find('input');
const contact = (wrapper: Panel) => field(wrapper, 'Contact (optional)');
const credit = (wrapper: Panel) => field(wrapper, 'Name for the acknowledgments (optional)');
const link = (wrapper: Panel) => field(wrapper, 'Link for your name (optional)');
const consent = (wrapper: Panel) => wrapper.get('input[type="checkbox"]');

describe('the feedback panel', () => {
  test('connects when it opens, and says who reads it', async () => {
    const wrapper = await opened();
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Only the author can read your feedback, unless you agree below');
    expect(wrapper.text()).toContain(
      'Your contact details are used only to reply to you, and are deleted after 90 days.',
    );
    expect(wrapper.text()).toContain("The feedback itself is kept as the project's archive of suggestions.");
  });

  test('sends what was written with the page it came from, and says thank you', async () => {
    const wrapper = await opened('room');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('input[value="words"]').setValue(true);
    await wrapper.get('textarea').setValue('  More terms from biology, please.  ');
    expect(wrapper.text()).toContain('32 / 1000');
    await contact(wrapper)?.setValue(' me@example.com ');
    await credit(wrapper)?.setValue('  Ann   L ');
    await link(wrapper)?.setValue(' https://ann.example/ ');
    await consent(wrapper).setValue(true);
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    // What goes is what the rules made of it, as the server will keep it.
    expect(socket.send).toHaveBeenCalledWith('meta:feedback', {
      kind: 'words',
      text: 'More terms from biology, please.',
      contact: 'me@example.com',
      credit: 'Ann L',
      link: 'https://ann.example/',
      publicIssue: true,
      version: 'dev',
      language: 'en',
      page: 'room',
    });
    expect(toasts.map(({ key }) => key)).toEqual(['feedback.sent']);
    // The panel has closed, and opens empty the next time.
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('');
    expect(link(wrapper)).toBeUndefined();
    expect((consent(wrapper).element as HTMLInputElement).checked).toBe(false);
  });

  test('keeps what was written while the panel is closed, even once the button is gone', async () => {
    const wrapper = await opened('room');
    await wrapper.get('input[value="bug"]').setValue(true);
    await wrapper.get('textarea').setValue('The clock stops when');
    await credit(wrapper)?.setValue('Ann L');
    await link(wrapper)?.setValue('https://ann.example/');
    await consent(wrapper).setValue(true);
    // Closed, and the whole thing unmounted, as when the room menu that holds it closes.
    wrapper.unmount();
    const again = await opened('room');
    expect((again.get('textarea').element as HTMLTextAreaElement).value).toBe('The clock stops when');
    expect((again.get('input[value="bug"]').element as HTMLInputElement).checked).toBe(true);
    expect((credit(again)?.element as HTMLInputElement).value).toBe('Ann L');
    expect((link(again)?.element as HTMLInputElement).value).toBe('https://ann.example/');
    expect((consent(again).element as HTMLInputElement).checked).toBe(true);
    // Sent, it is gone.
    await again.get('form').trigger('submit');
    await flushPromises();
    await again.get('button').trigger('click');
    expect((again.get('textarea').element as HTMLTextAreaElement).value).toBe('');
    expect((again.get('input[value="idea"]').element as HTMLInputElement).checked).toBe(true);
    expect((credit(again)?.element as HTMLInputElement).value).toBe('');
    expect((consent(again).element as HTMLInputElement).checked).toBe(false);
  });

  test('leaves out a contact or a name that shows nothing, and asks for no public issue unless ticked', async () => {
    const wrapper = await opened();
    await wrapper.get('textarea').setValue('Hi');
    await contact(wrapper)?.setValue('   ');
    await credit(wrapper)?.setValue(' \u200b ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('contact');
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('credit');
    expect(socket.send.mock.calls[0]?.[1]).toMatchObject({ publicIssue: false });
  });

  test('asks for a link once there is a name, and sends it with the name only', async () => {
    const wrapper = await opened();
    await wrapper.get('textarea').setValue('Hi');
    expect(link(wrapper)).toBeUndefined();
    await credit(wrapper)?.setValue('Ann');
    expect(link(wrapper)?.attributes('inputmode')).toBe('url');
    expect(wrapper.text()).toContain('It starts with https://; no email addresses.');
    await link(wrapper)?.setValue('https://ann.example/');
    // Taken back, the name takes the link with it, which stays in the field for when it comes back.
    await credit(wrapper)?.setValue('');
    expect(link(wrapper)).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('link');
  });

  test('says what a public issue would show, and what never', async () => {
    const wrapper = await opened();
    const box = consent(wrapper);
    expect((box.element as HTMLInputElement).checked).toBe(false);
    expect(box.element.closest('label')?.textContent).toContain('You may publish this as a GitHub issue');
    const note = wrapper.get(`#${box.attributes('aria-describedby')}`);
    expect(note.text()).toBe(
      'Only the text is published, with your name if you left one; your contact details never are.',
    );
  });

  test('says that a bug report takes the browser along, and only then', async () => {
    const wrapper = await opened();
    expect(wrapper.text()).not.toContain("your browser's user agent");
    await wrapper.get('input[value="bug"]').setValue(true);
    expect(wrapper.text()).toContain("your browser's user agent is sent along");
  });

  test("won't send what the server would refuse", async () => {
    const wrapper = await opened();
    await wrapper.get('textarea').setValue(' \n ');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('textarea').setValue('x'.repeat(1001));
    expect(wrapper.text()).toContain('Use at most 1000 characters.');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('textarea').setValue('Fine');
    await contact(wrapper)?.setValue('x'.repeat(101));
    expect(wrapper.text()).toContain('Use at most 100 characters for the contact.');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await contact(wrapper)?.setValue('me@example.com');
    await credit(wrapper)?.setValue('x'.repeat(17));
    expect(wrapper.text()).toContain('Use 1 to 16 visible characters for the name.');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await credit(wrapper)?.setValue('Ann');
    await link(wrapper)?.setValue('ann@example.com');
    expect(wrapper.text()).toContain('Use a web address that starts with https://, not an email address.');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await link(wrapper)?.setValue(`https://ann.example/${'x'.repeat(200)}`);
    expect(wrapper.text()).toContain('Use at most 200 characters for the link.');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await link(wrapper)?.setValue('https://ann.example/');
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
  });

  test("shows the server's refusal and keeps what was written", async () => {
    socket.send.mockResolvedValue({ ok: false, error: 'feedback_limited' });
    const wrapper = await opened();
    await wrapper.get('textarea').setValue('Again');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'At most 3 pieces of feedback can come from one network in 10 minutes. Please try again later.',
    );
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Again');
    expect(toasts).toEqual([]);
    // The refusal goes once the feedback is changed.
    await wrapper.get('textarea').setValue('Again, later');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
