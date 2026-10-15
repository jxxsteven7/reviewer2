// @vitest-environment happy-dom
import type { Ack } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import JoinForm from './JoinForm.vue';

const room = vi.hoisted(() => ({ submitChoice: vi.fn<(play: boolean) => Promise<Ack>>() }));
vi.mock('../room', () => room);
// A guest, unless a test logs in.
const signedIn = vi.hoisted(() => ({ account: { loaded: true, summary: null as object | null, mail: false } }));
vi.mock('../account', async () => {
  const { reactive } = await import('vue');
  signedIn.account = reactive(signedIn.account);
  return signedIn;
});

beforeEach(() => {
  signedIn.account.summary = null;
  setLanguage('en', { remember: false });
  room.submitChoice.mockReset();
});

async function joined(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

describe('JoinForm', () => {
  test('asks a guest for no name, only whether they play, and shows what the server had against joining', async () => {
    room.submitChoice.mockResolvedValue({ ok: false, error: 'room_full' });
    const wrapper = mount(JoinForm, { props: { code: 'ABCD' }, global: { plugins: [i18n] } });
    expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(false);
    expect(wrapper.findAll('input[type="text"]')).toHaveLength(0);
    // The second choice is to watch.
    await wrapper.findAll('input[type="radio"]')[1]?.setValue(true);
    await joined(wrapper);
    expect(room.submitChoice).toHaveBeenCalledWith(false);
    expect(wrapper.get('[role="alert"]').text()).toBe('This room is full.');
  });

  test('shows a player who is logged in their username, and nothing held against a join that was granted', async () => {
    signedIn.account.summary = { username: 'Ann', avatar: null, email: 'none', titles: [], contributions: [] };
    room.submitChoice.mockResolvedValue({ ok: false, error: 'removed_recently' });
    const wrapper = mount(JoinForm, { props: { code: 'ABCD' }, global: { plugins: [i18n] } });
    expect(wrapper.text()).toContain('Ann');
    await joined(wrapper);
    expect(room.submitChoice).toHaveBeenCalledWith(true);
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'You were removed from this room. You can come back in two minutes.',
    );
    room.submitChoice.mockResolvedValue({ ok: true });
    await joined(wrapper);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
