// @vitest-environment happy-dom
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { reactive } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import { toasts } from '../toast';
import SendFeedback from './SendFeedback.vue';

const socket = vi.hoisted(() => ({
  send: vi.fn<(event: string, payload?: object) => Promise<{ ok: true } | { ok: false; error: string }>>(),
  connect: vi.fn(),
}));
vi.mock('../socket', () => socket);
// Who the browser is, as the server last said: a guest, until a test logs in.
const signedIn = vi.hoisted(() => ({ account: null as unknown as { loaded: boolean; summary: object | null } }));
vi.mock('../account', () => {
  signedIn.account = reactive({ loaded: true, summary: null, mail: false });
  return signedIn;
});
const route = vi.hoisted(() => ({ path: '/room/ABCD' }));
vi.mock('vue-router', async () => ({
  useRoute: () => route,
  RouterLink: (await import('@vue/test-utils')).RouterLinkStub,
}));

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });
// The sheet is teleported to the page's body; rendering it in place keeps it inside the wrapper.
const global = () => ({ plugins: [i18n()], stubs: { teleport: true } });

beforeEach(() => {
  socket.send.mockReset();
  socket.send.mockResolvedValue({ ok: true });
  socket.connect.mockReset();
  toasts.splice(0);
  signedIn.account.loaded = true;
  signedIn.account.summary = null;
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
const credit = (wrapper: Panel) => field(wrapper, 'Your name (optional)');

describe('the feedback panel', () => {
  test('connects when it opens, and says who reads it', async () => {
    const wrapper = await opened();
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain(
      'What you write may be published as a GitHub issue; your contact details never are.',
    );
    expect(wrapper.text()).toContain('They are used only to reply to you, and are deleted after 90 days.');
    // Nothing to tick: whatever is adopted becomes an issue, and the name decides who is listed.
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Leave it empty to stay anonymous.');
    expect(wrapper.text()).toContain(
      "The feedback itself is kept as the project's archive of suggestions; only what the author discards, " +
        'such as spam, is deleted 30 days after it is discarded.',
    );
  });

  test('sends what was written with the page it came from, and says thank you', async () => {
    const wrapper = await opened('room');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('input[value="words"]').setValue(true);
    await wrapper.get('textarea').setValue('  More terms from biology, please.  ');
    expect(wrapper.text()).toContain('32 / 1000');
    await contact(wrapper)?.setValue(' me@example.com ');
    await credit(wrapper)?.setValue('  Ann   L ');
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    // What goes is what the rules made of it, as the server will keep it.
    expect(socket.send).toHaveBeenCalledWith('meta:feedback', {
      kind: 'words',
      text: 'More terms from biology, please.',
      contact: 'me@example.com',
      credit: 'Ann L',
      version: 'dev',
      language: 'en',
      page: 'room',
    });
    expect(toasts.map(({ key }) => key)).toEqual(['feedback.sent']);
    // The panel has closed, and opens empty the next time.
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('');
    expect((credit(wrapper)?.element as HTMLInputElement).value).toBe('');
  });

  test('keeps what was written while the panel is closed, even once the button is gone', async () => {
    const wrapper = await opened('room');
    await wrapper.get('input[value="bug"]').setValue(true);
    await wrapper.get('textarea').setValue('The clock stops when');
    await credit(wrapper)?.setValue('Ann L');
    // Closed, and the whole thing unmounted, as when the room menu that holds it closes.
    wrapper.unmount();
    const again = await opened('room');
    expect((again.get('textarea').element as HTMLTextAreaElement).value).toBe('The clock stops when');
    expect((again.get('input[value="bug"]').element as HTMLInputElement).checked).toBe(true);
    expect((credit(again)?.element as HTMLInputElement).value).toBe('Ann L');
    // Sent, it is gone.
    await again.get('form').trigger('submit');
    await flushPromises();
    await again.get('button').trigger('click');
    expect((again.get('textarea').element as HTMLTextAreaElement).value).toBe('');
    expect((again.get('input[value="idea"]').element as HTMLInputElement).checked).toBe(true);
    expect((credit(again)?.element as HTMLInputElement).value).toBe('');
  });

  test('leaves out a contact or a name that shows nothing', async () => {
    const wrapper = await opened();
    await wrapper.get('textarea').setValue('Hi');
    await contact(wrapper)?.setValue('   ');
    await credit(wrapper)?.setValue(' \u200b ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('contact');
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('credit');
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('publicIssue');
  });

  test('asks a guest to log in first, by a way back to their room, and lets them send all the same', async () => {
    const wrapper = await opened('room');
    expect(wrapper.get('.guest').text()).toContain(
      "You aren't logged in. Log in first, and if your feedback is adopted, it counts for your account.",
    );
    const signIn = wrapper.getComponent(RouterLinkStub);
    expect(signIn.text()).toBe('Log in');
    expect(signIn.props('to')).toEqual({ path: '/account', query: { next: '/room/ABCD' } });
    // From the home page, the account page leads home, as it does by itself.
    route.path = '/';
    expect((await opened()).getComponent(RouterLinkStub).props('to')).toBe('/account');
    route.path = '/room/ABCD';
    await wrapper.get('textarea').setValue('Hi');
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
  });

  test('offers a player who is logged in and leaves a name to let it open their page, ticked until they untick it', async () => {
    const box = (wrapper: Panel) => wrapper.find('input[type="checkbox"]');
    // A guest, with a name or not, is offered nothing.
    let wrapper = await opened();
    await credit(wrapper)?.setValue('Ann');
    expect(box(wrapper).exists()).toBe(false);
    await wrapper.get('textarea').setValue('Hi');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('linkProfile');

    // Logged in, the box shows with a name only, ticked.
    signedIn.account.summary = { username: 'ann' };
    wrapper = await opened();
    expect(box(wrapper).exists()).toBe(false);
    await credit(wrapper)?.setValue('Ann');
    expect((box(wrapper).element as HTMLInputElement).checked).toBe(true);
    expect(box(wrapper).element.closest('label')?.textContent).toContain(
      'Let my name in the feedback contributions open my public page',
    );
    await wrapper.get('textarea').setValue('Hi');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[1]?.[1]).toMatchObject({ credit: 'Ann', linkProfile: true });

    // Unticked, it says no, and the box is ticked again for the next feedback.
    await wrapper.get('button').trigger('click');
    await credit(wrapper)?.setValue('Ann');
    await box(wrapper).setValue(false);
    await wrapper.get('textarea').setValue('Hi again');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[2]?.[1]).toMatchObject({ credit: 'Ann', linkProfile: false });
    await wrapper.get('button').trigger('click');
    await credit(wrapper)?.setValue('Ann');
    expect((box(wrapper).element as HTMLInputElement).checked).toBe(true);

    // Without a name, nothing is said of it.
    await credit(wrapper)?.setValue('');
    expect(box(wrapper).exists()).toBe(false);
    await wrapper.get('textarea').setValue('Hi once more');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[3]?.[1]).not.toHaveProperty('linkProfile');
  });

  test('asks nothing of a player who is logged in, or before the server has said who they are', async () => {
    signedIn.account.summary = { username: 'Ann' };
    expect((await opened()).find('.guest').exists()).toBe(false);
    signedIn.account.summary = null;
    signedIn.account.loaded = false;
    expect((await opened()).find('.guest').exists()).toBe(false);
  });

  test('says that a bug report takes the browser along, and only then', async () => {
    const wrapper = await opened();
    expect(wrapper.text()).not.toContain("your browser's user agent");
    await wrapper.get('input[value="bug"]').setValue(true);
    expect(wrapper.text()).toContain("your browser's user agent is sent along");
  });

  test('offers a new game as a kind, says what to write about it, and sends it with a name', async () => {
    const wrapper = await opened();
    expect(wrapper.findAll('input[type="radio"]').map((input) => input.attributes('value'))).toEqual([
      'idea',
      'game',
      'bug',
      'words',
    ]);
    expect(wrapper.text()).toContain('A new game');
    expect(wrapper.text()).not.toContain('Which game should we make next?');
    await wrapper.get('input[value="game"]').setValue(true);
    expect(wrapper.text()).toContain('Which game should we make next?');
    await wrapper.get('textarea').setValue('A game of peer review where the reviewers bid on papers.');
    await credit(wrapper)?.setValue('Ann');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[0]?.[1]).toMatchObject({ kind: 'game', credit: 'Ann' });
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('link');
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
    expect(wrapper.text()).not.toContain('Use 1 to 16 visible characters for the name.');
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
