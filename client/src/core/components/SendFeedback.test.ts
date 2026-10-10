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

const submit = (wrapper: Awaited<ReturnType<typeof opened>>) => wrapper.get('form button[type="submit"]');

describe('the feedback panel', () => {
  test('connects when it opens, and says who reads it', async () => {
    const wrapper = await opened();
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Only the author can read this.');
    expect(wrapper.text()).toContain('Your contact details are used only to reply to you.');
  });

  test('sends what was written with the page it came from, and says thank you', async () => {
    const wrapper = await opened('room');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('input[value="words"]').setValue(true);
    await wrapper.get('textarea').setValue('  More terms from biology, please.  ');
    expect(wrapper.text()).toContain('32 / 1000');
    await wrapper.get('input:not([type="radio"])').setValue(' me@example.com ');
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    // What goes is what the rules made of it, as the server will keep it.
    expect(socket.send).toHaveBeenCalledWith('meta:feedback', {
      kind: 'words',
      text: 'More terms from biology, please.',
      contact: 'me@example.com',
      version: 'dev',
      language: 'en',
      page: 'room',
    });
    expect(toasts.map(({ key }) => key)).toEqual(['feedback.sent']);
    // The panel has closed, and opens empty the next time.
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('');
  });

  test('keeps what was written while the panel is closed, even once the button is gone', async () => {
    const wrapper = await opened('room');
    await wrapper.get('input[value="bug"]').setValue(true);
    await wrapper.get('textarea').setValue('The clock stops when');
    // Closed, and the whole thing unmounted, as when the room menu that holds it closes.
    wrapper.unmount();
    const again = await opened('room');
    expect((again.get('textarea').element as HTMLTextAreaElement).value).toBe('The clock stops when');
    expect((again.get('input[value="bug"]').element as HTMLInputElement).checked).toBe(true);
    // Sent, it is gone.
    await again.get('form').trigger('submit');
    await flushPromises();
    await again.get('button').trigger('click');
    expect((again.get('textarea').element as HTMLTextAreaElement).value).toBe('');
    expect((again.get('input[value="idea"]').element as HTMLInputElement).checked).toBe(true);
  });

  test('leaves out a contact that shows nothing', async () => {
    const wrapper = await opened();
    await wrapper.get('textarea').setValue('Hi');
    await wrapper.get('input:not([type="radio"])').setValue('   ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('contact');
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
    await wrapper.get('input:not([type="radio"])').setValue('x'.repeat(101));
    expect(wrapper.text()).toContain('Use at most 100 characters for the contact.');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
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
