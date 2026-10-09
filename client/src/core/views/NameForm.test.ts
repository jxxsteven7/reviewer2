// @vitest-environment happy-dom
import type { Ack } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { i18n, setLanguage } from '../i18n';
import NameForm from './NameForm.vue';

const room = vi.hoisted(() => ({ submitName: vi.fn<(name: string | undefined, play: boolean) => Promise<Ack>>() }));
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
  room.submitName.mockReset();
});

const TAKEN = 'Someone in the room already has that name.';

async function joined(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

describe('NameForm', () => {
  test('shows a guest what the server had against the name, in the field', async () => {
    room.submitName.mockResolvedValue({ ok: false, error: 'name_taken' });
    const wrapper = mount(NameForm, { props: { code: 'ABCD' }, global: { plugins: [i18n] } });
    await wrapper.get('input[autocomplete="nickname"]').setValue('Ann');
    await joined(wrapper);
    expect(room.submitName).toHaveBeenCalledWith('Ann', expect.any(Boolean));
    expect(wrapper.text()).toContain(TAKEN);
  });

  test('shows a player who is logged in what the server had against joining, below the form', async () => {
    signedIn.account.summary = { username: 'Ann', avatar: null, email: 'none', titles: [] };
    room.submitName.mockResolvedValue({ ok: false, error: 'name_taken' });
    const wrapper = mount(NameForm, { props: { code: 'ABCD' }, global: { plugins: [i18n] } });
    // There is no field for a name: the username is the name.
    expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Ann');
    await joined(wrapper);
    expect(room.submitName).toHaveBeenCalledWith(undefined, expect.any(Boolean));
    expect(wrapper.get('[role="alert"]').text()).toBe(TAKEN);
    // Nothing is held against a join that was granted.
    room.submitName.mockResolvedValue({ ok: true });
    await joined(wrapper);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
