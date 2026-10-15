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
// Who the browser is, as the server last said: a guest, until a test logs in; and the page's way
// of asking again, which a test answers by setting what the server would have said.
const signedIn = vi.hoisted(() => ({
  account: null as unknown as { loaded: boolean; summary: object | null },
  loadAccount: vi.fn(),
}));
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
  signedIn.loadAccount.mockReset();
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
const credit = (wrapper: Panel) => field(wrapper, 'Your name');
// Chooses to sign the feedback, as the panel does at first, or to stay anonymous.
const sign = (wrapper: Panel) => wrapper.get('input[value="signed"]').setValue(true);
const anonymous = (wrapper: Panel) => wrapper.get('input[value="anonymous"]').setValue(true);
const checked = (wrapper: Panel, value: string) =>
  (wrapper.get(`input[value="${value}"]`).element as HTMLInputElement).checked;

describe('the feedback panel', () => {
  test('connects when it opens, and says who reads it', async () => {
    const wrapper = await opened();
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain(
      'What you write may be published as a GitHub issue; your contact details never are.',
    );
    expect(wrapper.text()).toContain('They are used only to reply to you, and are deleted after 90 days.');
    // Nothing to tick: whatever is adopted becomes an issue, and signing it decides who is listed,
    // by name unless the player chooses to stay anonymous; a guest's name is their own.
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(checked(wrapper, 'signed')).toBe(true);
    expect(credit(wrapper)).toBeDefined();
    expect(wrapper.text()).toContain('The name is listed among the feedback contributions on the home page');
    await anonymous(wrapper);
    expect(wrapper.text()).toContain('You are listed as an anonymous player');
    expect(credit(wrapper)).toBeUndefined();
    // The choice outlives the panel, as what is written does, so the next test starts signed.
    await sign(wrapper);
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
    // Signed, as the panel starts, it waits for a name.
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
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
    expect(checked(again, 'signed')).toBe(true);
    expect((credit(again)?.element as HTMLInputElement).value).toBe('');
  });

  test('leaves out a contact that shows nothing, and a name unless the player signs', async () => {
    const wrapper = await opened();
    await wrapper.get('textarea').setValue('Hi');
    await contact(wrapper)?.setValue('   ');
    // A name that shows nothing is no name, which signing needs.
    await credit(wrapper)?.setValue(' \u200b ');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    // Typed, and then anonymous after all, it stays behind.
    await credit(wrapper)?.setValue('Ann');
    await anonymous(wrapper);
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
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
    await anonymous(wrapper);
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await sign(wrapper);
  });

  test('signs with the account of a player who is logged in, by its avatar and username', async () => {
    signedIn.account.summary = { username: 'ann', avatar: null };
    const wrapper = await opened();
    // Signed from the start, with nothing to fill in.
    expect(checked(wrapper, 'signed')).toBe(true);
    expect(credit(wrapper)).toBeUndefined();
    expect(wrapper.get('.signer').text()).toBe('ann');
    expect(wrapper.find('.signer .avatar').exists()).toBe(true);
    expect(wrapper.text()).toContain('a tap on either opens your panel');
    await wrapper.get('textarea').setValue('Hi');
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    // Signed with the account, which the server keeps in place of any name.
    expect(socket.send.mock.calls[0]?.[1]).toMatchObject({ linkProfile: true });
    expect(socket.send.mock.calls[0]?.[1]).not.toHaveProperty('credit');

    // Anonymous, nothing is said of the account, which the server knows all the same.
    await wrapper.get('button').trigger('click');
    expect(checked(wrapper, 'signed')).toBe(true);
    await anonymous(wrapper);
    expect(wrapper.find('.signer').exists()).toBe(false);
    await wrapper.get('textarea').setValue('Hi again');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[1]?.[1]).not.toHaveProperty('linkProfile');
    expect(socket.send.mock.calls[1]?.[1]).not.toHaveProperty('credit');

    // A guest who signs leaves a name, and never links an account.
    signedIn.account.summary = null;
    const guest = await opened();
    await credit(guest)?.setValue('Ann');
    await guest.get('textarea').setValue('Hi once more');
    await guest.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send.mock.calls[2]?.[1]).toMatchObject({ credit: 'Ann' });
    expect(socket.send.mock.calls[2]?.[1]).not.toHaveProperty('linkProfile');
  });

  test('asks nothing of a player who is logged in, or before the server has said who they are', async () => {
    signedIn.account.summary = { username: 'Ann' };
    expect((await opened()).find('.guest').exists()).toBe(false);
    signedIn.account.summary = null;
    signedIn.account.loaded = false;
    const wrapper = await opened();
    expect(wrapper.find('.guest').exists()).toBe(false);
    // Nor for a name, which a player who turns out to be logged in wouldn't need, and nothing is
    // sent signed meanwhile, which would go as anonymous; nor is anything said of anonymity, which
    // the player didn't choose. Once the server has answered, a guest is asked for a name.
    expect(checked(wrapper, 'signed')).toBe(true);
    expect(credit(wrapper)).toBeUndefined();
    expect(wrapper.find('.signer').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('You are listed as an anonymous player');
    await wrapper.get('textarea').setValue('Early');
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(socket.send).not.toHaveBeenCalled();
    // Anonymous feedback waits for nobody.
    await anonymous(wrapper);
    expect(wrapper.text()).toContain('You are listed as an anonymous player');
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await sign(wrapper);
    signedIn.account.loaded = true;
    await flushPromises();
    expect(credit(wrapper)).toBeDefined();
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await credit(wrapper)?.setValue('Ann');
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await wrapper.get('textarea').setValue('');
  });

  test("asks again who the browser is when the server couldn't sign with the account", async () => {
    signedIn.account.summary = { username: 'ann', avatar: null };
    socket.send.mockResolvedValue({ ok: false, error: 'feedback_unsigned' });
    const wrapper = await opened();
    await wrapper.get('textarea').setValue('Signed, I thought');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "The feedback couldn't be signed with your account. Try again, log in again, or choose Anonymously.",
    );
    expect(signedIn.loadAccount).toHaveBeenCalledOnce();
    expect(toasts).toEqual([]);
    // The login had ended: the form turns to a guest's, asking for a name, with the refusal still
    // up and what was written kept.
    signedIn.account.summary = null;
    await flushPromises();
    expect(wrapper.find('.guest').exists()).toBe(true);
    expect(wrapper.find('.signer').exists()).toBe(false);
    expect(credit(wrapper)).toBeDefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Signed, I thought');
    // Any other refusal leaves the question alone.
    socket.send.mockResolvedValue({ ok: false, error: 'feedback_limited' });
    await credit(wrapper)?.setValue('Ann');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(signedIn.loadAccount).toHaveBeenCalledOnce();
    await wrapper.get('textarea').setValue('');
    await credit(wrapper)?.setValue('');
  });

  test('says that a bug report takes the browser along, and only then', async () => {
    const wrapper = await opened();
    expect(wrapper.text()).not.toContain("your browser's user agent");
    await wrapper.get('input[value="bug"]').setValue(true);
    expect(wrapper.text()).toContain("your browser's user agent is sent along");
  });

  test('offers a new game as a kind, says what to write about it, and sends it with a name', async () => {
    const wrapper = await opened();
    expect(wrapper.findAll('.kinds input[type="radio"]').map((input) => input.attributes('value'))).toEqual([
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
    // Signed, a guest needs a name; anonymous, none.
    expect(submit(wrapper).attributes('disabled')).toBeDefined();
    await anonymous(wrapper);
    expect(submit(wrapper).attributes('disabled')).toBeUndefined();
    await sign(wrapper);
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
    await anonymous(wrapper);
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
