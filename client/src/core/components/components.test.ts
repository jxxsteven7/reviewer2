// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../locales/en.json';
import { knowAliases } from '../names';
import { provideOpenPlayer } from '../playerPanel';
import { shownProfile } from '../profilePanel';
import AvatarButton from './AvatarButton.vue';
import BackButton from './BackButton.vue';
import FieldFold from './FieldFold.vue';
import FieldPicker from './FieldPicker.vue';
import PageMasthead from './PageMasthead.vue';
import PageTitle from './PageTitle.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import PlayerName from './PlayerName.vue';
import ProfilePanel from './ProfilePanel.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';
import LanguageGate from '../views/LanguageGate.vue';

// The panel that an avatar opens outside a room reads the page, which no server answers here.
vi.mock('../account', async (actual) => ({
  ...(await actual<typeof import('../account')>()),
  request: vi.fn(async () => ({ ok: false, error: 'no_such_profile' })),
}));

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });
const global = () => ({ plugins: [i18n()] });

describe('PlayerName', () => {
  test('marks the viewer, the chair and offline players', () => {
    const wrapper = mount(PlayerName, {
      props: { player: { id: 'a', name: 'Ann', online: false }, me: true, chair: true },
      global: global(),
    });
    expect(wrapper.text()).toContain('Ann');
    expect(wrapper.text()).toContain('you');
    expect(wrapper.text()).toContain('chair');
    expect(wrapper.text()).toContain('offline');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  test("opens the player's panel from the avatar in a room, and leaves the name as text", async () => {
    const opened: string[] = [];
    const room = defineComponent({
      setup(_, { slots }) {
        provideOpenPlayer((id) => opened.push(id));
        return () => slots.default?.();
      },
    });
    const player = { id: 'b', name: 'Bob', online: true };
    const wrapper = mount(room, {
      slots: { default: () => h(PlayerName, { player, me: false, chair: false }) },
      global: global(),
    });
    const button = wrapper.get('button.avatar-button');
    expect(button.attributes('aria-label')).toBe("View Bob's profile");
    expect(wrapper.get('.name').element.tagName).toBe('SPAN');
    await button.trigger('click');
    expect(opened).toEqual(['b']);
  });

  test('shows the academic rank of a player with an account, and none for a guest', () => {
    const ranked = mount(PlayerName, {
      props: {
        player: { id: 'a', name: 'Ann', online: true, rank: 'phd' as const },
        me: false,
        chair: false,
      },
      global: global(),
    });
    expect(ranked.find('.rank').text()).toBe('PhD student');
    const guest = mount(PlayerName, {
      props: { player: { id: 'b', name: 'Bob', online: true }, me: false, chair: false },
      global: global(),
    });
    expect(guest.find('.rank').exists()).toBe(false);
  });

  test('marks an AI player with the robot that is its avatar, and a player whom an AI plays for', () => {
    const ai = mount(PlayerName, {
      props: {
        player: { id: 'ai', name: 'Reviewer 1', online: true, agent: 'reviewer1' as const },
        me: false,
        chair: false,
      },
      global: global(),
    });
    expect(ai.get('.mark.agent').text()).toBe('AI');
    expect(ai.get('.mark.agent').find('svg').exists()).toBe(true);
    expect(ai.get('.avatar').find('svg').exists()).toBe(true);
    expect(ai.get('.avatar').find('.initial').exists()).toBe(false);
    const played = mount(PlayerName, {
      props: {
        player: { id: 'a', name: 'Ann', online: false, takenOver: true as const },
        me: false,
        chair: false,
      },
      global: global(),
    });
    // Offline, said to a screen reader alone, with the avatar of someone the room waits for.
    expect(played.findAll('.mark').map((mark) => mark.text())).toEqual(['AI playing']);
    expect(played.get('.sr-only').text()).toBe('offline');
    expect(played.find('.avatar.veiled .wait').exists()).toBe(true);
    expect(played.get('.avatar').find('svg').exists()).toBe(false);
  });
});

describe('FieldPicker', () => {
  const fields = [
    { id: 'general', name: { zh: 'G', en: 'General' }, counts: { zh: 30, en: 30 } },
    { id: 'small', name: { zh: 'S', en: 'Small' }, counts: { zh: 30, en: 3 } },
  ];

  test('offers only the lists with enough words in the language', async () => {
    const wrapper = mount(FieldPicker, {
      props: { fields, language: 'en', needed: 25, modelValue: [], 'onUpdate:modelValue': () => {} },
      global: global(),
    });
    const boxes = wrapper.findAll('input');
    expect(boxes[0]?.attributes('disabled')).toBeUndefined();
    expect(boxes[1]?.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('30 terms');
    expect(wrapper.text()).toContain('Not enough terms in this language');
    await boxes[0]?.setValue(true);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['general']]);
  });
});

describe('FieldFold', () => {
  const fields = [{ id: 'general', name: { zh: 'G', en: 'General' }, counts: { zh: 30, en: 30 } }];

  // The lists unfold with their height eased from nothing, and fold back to nothing before they are
  // hidden; the marker's state and the hidden lists switch at once. The transition is the real one
  // here, with the hooks of useFold.ts.
  test('unfolds and folds its lists with their height eased, and hides them once they have folded', async () => {
    vi.useFakeTimers();
    const wrapper = mount(FieldFold, {
      props: { fields, language: 'en', needed: 25, modelValue: ['general'], 'onUpdate:modelValue': () => {} },
      global: { ...global(), stubs: { transition: false } },
      attachTo: document.body,
    });
    const toggle = wrapper.get('.toggle');
    const lists = wrapper.get('.lists').element as HTMLElement;
    expect(lists.style.display).toBe('none');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(lists.style.display).toBe('');
    expect(lists.style.overflow).toBe('hidden');
    expect(lists.style.transition).toContain('height');
    vi.advanceTimersByTime(300);
    expect(lists.style.height).toBe('');
    expect(lists.style.overflow).toBe('');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(lists.style.display).toBe('');
    expect(lists.style.height).toBe('0px');
    expect(lists.style.paddingTop).toBe('0px');
    vi.advanceTimersByTime(300);
    expect(lists.style.display).toBe('none');
    expect(lists.style.height).toBe('');
    wrapper.unmount();
    vi.useRealTimers();
  });
});

describe('PlayerAvatar', () => {
  test('shows the uploaded picture, and the default when it has none or it fails to load', async () => {
    const wrapper = mount(PlayerAvatar, { props: { name: 'ann', avatar: '/avatars/a.webp' } });
    expect(wrapper.get('img').attributes('src')).toBe('/avatars/a.webp');
    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('.initial').attributes('data-initial')).toBe('A');
    // The initial is drawn, not written: the name beside the avatar is the text.
    expect(wrapper.text()).toBe('');
    // A new picture is tried again.
    await wrapper.setProps({ avatar: '/avatars/b.webp' });
    expect(wrapper.get('img').attributes('src')).toBe('/avatars/b.webp');

    const fallback = mount(PlayerAvatar, { props: { name: 'Bob' } });
    expect(fallback.get('.initial').attributes('data-initial')).toBe('B');
    expect(fallback.attributes('style')).toContain('background');
    expect(fallback.attributes('aria-hidden')).toBe('true');
  });

  test("is colored by a guest's number, whatever the page calls them", () => {
    const styleOf = (name: string, guest?: number) =>
      mount(PlayerAvatar, { props: { name, guest } }).attributes('style');
    expect(styleOf('Guest 3', 3)).toContain('var(--avatar-3)');
    expect(styleOf('\u{6e38}\u{5ba2}3', 3)).toBe(styleOf('Guest 3', 3));
    expect(styleOf('Guest 11', 11)).toContain('var(--avatar-3)');
    expect(styleOf('Guest 3')).not.toBe(styleOf('\u{6e38}\u{5ba2}3'));
  });
  // The room names a friend by the viewer's name for them, with the username kept beside
  // (room.ts): the name says who it is, and the default avatar is still the username's.
  test("names a friend by the viewer's name for them, and draws the avatar from the username", () => {
    const player = { id: 'b', name: 'Prof. B', username: 'Bob', handle: 'b0b000000000', online: true };
    const named = mount(PlayerName, { props: { player, me: false, chair: false }, global: global() });
    const plain = mount(PlayerName, {
      props: { player: { id: 'b', name: 'Bob', online: true }, me: false, chair: false },
      global: global(),
    });
    expect(named.get('.name').text()).toBe('Prof. B');
    expect(named.get('.initial').attributes('data-initial')).toBe('B');
    expect(named.get('.avatar').attributes('style')).toBe(plain.get('.avatar').attributes('style'));
  });
});

describe('AvatarButton', () => {
  test('is the avatar alone where the page opens no panel, as on a big screen', () => {
    const wrapper = mount(AvatarButton, { props: { playerId: 'b', name: 'Bob' }, global: global() });
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.get('.avatar').attributes('aria-hidden')).toBe('true');
  });

  test("opens the account's panel outside a room, as a room's avatar opens the player's", async () => {
    // The site's one panel (profilePanel.ts), which App.vue holds, here beside the avatar.
    const page = () => h('div', [h(AvatarButton, { handle: 'b0b000000000', name: 'Bob' }), h(ProfilePanel)]);
    const wrapper = mount(page, { global: global(), attachTo: document.body });
    const avatar = wrapper.get('button.avatar-button');
    expect(avatar.attributes('aria-label')).toBe("View Bob's profile");
    expect(avatar.attributes('aria-haspopup')).toBe('dialog');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    (avatar.element as HTMLButtonElement).focus();
    await avatar.trigger('click');
    expect(shownProfile.value).toEqual({ handle: 'b0b000000000', username: 'Bob' });
    await vi.waitFor(() => expect(document.querySelector('[role=dialog] h2')?.textContent?.trim()).toBe('Bob'));
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[role=dialog] button.close')?.click();
    await nextTick();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    // The focus comes back to the avatar.
    expect(document.activeElement).toBe(avatar.element);
    wrapper.unmount();
  });
});

describe('ProfilePanel', () => {
  test("names a friend by the viewer's name for them, with the username after it, on the panel and the whole page", async () => {
    knowAliases([{ handle: 'b0b000000000', alias: 'Bobby' }]);
    const page = () =>
      h('div', [h(AvatarButton, { handle: 'b0b000000000', name: 'Bobby', username: 'Bob' }), h(ProfilePanel)]);
    const wrapper = mount(page, { global: global(), attachTo: document.body });
    const avatar = wrapper.get('button.avatar-button');
    expect(avatar.attributes('aria-label')).toBe("View Bobby's profile");
    expect(wrapper.get('.initial').attributes('data-initial')).toBe('B');
    await avatar.trigger('click');
    expect(shownProfile.value).toEqual({ handle: 'b0b000000000', username: 'Bob' });
    const heading = (index: number) => document.querySelectorAll('[role=dialog] h2')[index];
    await vi.waitFor(() => expect(heading(0)?.textContent?.trim()).toBe('Bobby Bob'));
    expect(heading(0)?.querySelector('.subtitle')?.textContent?.trim()).toBe('Bob');
    [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')]
      .find((button) => button.textContent?.trim() === 'Open the full page')
      ?.click();
    await nextTick();
    expect(heading(1)?.textContent?.trim()).toBe('Bobby Bob');
    expect(heading(1)?.querySelector('.subtitle')?.textContent?.trim()).toBe('Bob');
    document.querySelector<HTMLButtonElement>('[role=dialog] button.close')?.click();
    await nextTick();
    // A name that is the username itself has nothing after it.
    knowAliases([{ handle: 'b0b000000000', alias: 'Bob' }]);
    await avatar.trigger('click');
    await vi.waitFor(() => expect(heading(0)?.textContent?.trim()).toBe('Bob'));
    expect(heading(0)?.querySelector('.subtitle')).toBeNull();
    document.querySelector<HTMLButtonElement>('[role=dialog] button.close')?.click();
    await nextTick();
    wrapper.unmount();
    knowAliases([]);
  });
});

describe('BackButton', () => {
  test('goes back to the page before on the site, and is not there for the first page of a visit', async () => {
    window.history.replaceState({ back: '/room/K7QX' }, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const wrapper = mount(BackButton, { global: global() });
    expect(wrapper.get('button').attributes('aria-label')).toBe('Go back');
    await wrapper.get('button').trigger('click');
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
    window.history.replaceState({ back: null }, '');
    expect(mount(BackButton, { global: global() }).find('button').exists()).toBe(false);
    window.history.replaceState(null, '');
    expect(mount(BackButton, { global: global() }).find('button').exists()).toBe(false);
  });
});

describe('PageMasthead', () => {
  // The wordmark links home, which takes a router.
  const masthead = (back: boolean) =>
    mount(PageMasthead, {
      props: { back },
      global: { ...global(), stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });

  // A room's masthead scrolls away with the page, but in the waiting room, where it is pinned.
  test("stays at the top of a room's page where it is pinned, with the tile alone on a narrow screen", () => {
    const room = mount(PageMasthead, {
      props: { compact: true },
      global: { ...global(), stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    expect(room.classes()).not.toContain('sticky');
    const waiting = mount(PageMasthead, {
      props: { compact: true, pinned: true },
      global: { ...global(), stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    expect(waiting.classes()).toEqual(expect.arrayContaining(['sticky', 'pinned']));
    expect(waiting.get('.wordmark').classes()).toContain('compact');
  });

  // A page with a way back keeps the bar of its title at the top once there is a page to go back
  // to, and the masthead scrolls away (docs/design.md); otherwise the masthead stays.
  test('gives the top to the bar of the title on a page with a page before, and stays otherwise', () => {
    window.history.replaceState({ back: '/' }, '');
    const listened = vi.spyOn(window, 'addEventListener');
    const page = masthead(true);
    expect(page.classes()).not.toContain('sticky');
    expect(page.find('.back-button').exists()).toBe(false);
    // A masthead that scrolls away has no shadow to show, and doesn't watch the page scroll.
    expect(listened).not.toHaveBeenCalledWith('scroll', expect.anything(), expect.anything());
    expect(masthead(false).classes()).toContain('sticky');
    expect(listened).toHaveBeenCalledWith('scroll', expect.anything(), expect.anything());
    listened.mockRestore();
    // A page opened from a shared link has nothing before it.
    window.history.replaceState(null, '');
    expect(masthead(true).classes()).toContain('sticky');
  });
});

describe('PageTitle', () => {
  const title = () => mount(PageTitle, { slots: { default: 'Your account' }, global: global() });

  test('has the way back before the title, and stays at the top, when there is a page before', () => {
    window.history.replaceState({ back: '/' }, '');
    const bar = title();
    expect(bar.find('.back-button + h1').exists()).toBe(true);
    expect(bar.get('h1').text()).toBe('Your account');
    expect(bar.classes()).toContain('pinned');
    window.history.replaceState(null, '');
    const alone = title();
    expect(alone.find('.back-button').exists()).toBe(false);
    expect(alone.get('h1').text()).toBe('Your account');
    expect(alone.classes()).not.toContain('pinned');
  });
});

describe('UiSheet', () => {
  // A sheet on the page's body, with three buttons in it, named by a prefix.
  function sheet(title: string, open = false) {
    const buttons = [1, 2, 3].map((n) => h('button', { id: `${title}${n}` }, String(n)));
    return mount(UiSheet, {
      props: { open, title },
      slots: { default: () => buttons },
      global: global(),
      attachTo: document.body,
    });
  }
  const press = (key: string, shiftKey = false) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, cancelable: true }));
  const focus = (id: string) => document.getElementById(id)?.focus();
  const active = () => document.activeElement?.id || document.activeElement?.className;

  test('leaves the keys to the sheet on top when one lies over another', async () => {
    const under = sheet('a');
    const over = sheet('b');
    await under.setProps({ open: true });
    await over.setProps({ open: true });
    await nextTick();
    // Escape closes the one on top only.
    press('Escape');
    expect(under.emitted('close')).toBeUndefined();
    expect(over.emitted('close')).toHaveLength(1);
    // Tab moves on inside the one on top, and wraps at its ends; the one below stays out of it.
    focus('b1');
    press('Tab');
    expect(active()).toBe('b1');
    focus('b3');
    press('Tab');
    expect(active()).toContain('round close');
    press('Tab', true);
    expect(active()).toBe('b3');
    // Once the one on top has gone, the one below takes the keys again.
    await over.setProps({ open: false });
    press('Escape');
    expect(under.emitted('close')).toHaveLength(1);
    under.unmount();
    over.unmount();
  });

  // The player's panel is on the page from the moment the room is entered, and the groups only from
  // the start of the game: the one opened last lies on top, wherever it is on the page.
  test('lays the sheet opened last over the others, whichever came onto the page first', async () => {
    const first = sheet('a');
    const second = sheet('b');
    const layer = (title: string) =>
      Number(
        [...document.querySelectorAll<HTMLElement>('.backdrop')].find((backdrop) =>
          backdrop.querySelector('h2')?.textContent?.includes(title),
        )?.style.zIndex,
      );
    await second.setProps({ open: true });
    await first.setProps({ open: true });
    expect(layer('a')).toBeGreaterThan(layer('b'));
    // Every sheet stays under the emotes (25), the toasts (30) and the menu of marks (35).
    expect(layer('a')).toBeLessThan(25);
    await first.setProps({ open: false });
    await first.setProps({ open: true });
    expect(layer('a')).toBeGreaterThan(layer('b'));
    // Closed and opened again, the one below comes back on top.
    await second.setProps({ open: false });
    await second.setProps({ open: true });
    expect(layer('b')).toBeGreaterThan(layer('a'));
    first.unmount();
    second.unmount();
  });

  test('casts a shadow under its head once what is under it has scrolled, also a list of its own', async () => {
    const list = h('div', { class: 'list' }, 'Lines');
    const wrapper = mount(UiSheet, {
      props: { open: true, title: 'Talk' },
      slots: { default: () => list },
      global: global(),
      attachTo: document.body,
    });
    await nextTick();
    const head = () => document.querySelector('[role=dialog] .head');
    const scroll = (element: Element | null, top: number) => {
      if (!(element instanceof HTMLElement)) throw new Error('nothing to scroll');
      element.scrollTop = top;
      element.dispatchEvent(new Event('scroll'));
    };
    // The head is above what scrolls, not in it.
    expect(document.querySelector('[role=dialog] .scroller .head')).toBeNull();
    expect(head()?.classList).not.toContain('scrolled');
    scroll(document.querySelector('[role=dialog] .scroller'), 40);
    await nextTick();
    expect(head()?.classList).toContain('scrolled');
    scroll(document.querySelector('[role=dialog] .scroller'), 0);
    await nextTick();
    expect(head()?.classList).not.toContain('scrolled');
    scroll(document.querySelector('[role=dialog] .list'), 12);
    await nextTick();
    expect(head()?.classList).toContain('scrolled');
    wrapper.unmount();
  });

  test('has a round button back before its title when it leads back to another', async () => {
    const wrapper = mount(UiSheet, {
      props: { open: true, title: 'Page', back: 'Back' },
      global: global(),
      attachTo: document.body,
    });
    const back = document.querySelector<HTMLButtonElement>('[role=dialog] button.back');
    expect(back?.getAttribute('aria-label')).toBe('Back');
    back?.click();
    expect(wrapper.emitted('back')).toHaveLength(1);
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  // A sheet with a way back leads back to the sheet under it, which needs no showing meanwhile: it is
  // hidden, scrim and all, and comes back as it was once the one over it has gone. A sheet with no way
  // back lies over the other, which stays in sight.
  test('hides the sheet under one with a way back, until that one goes', async () => {
    const under = sheet('a');
    const over = mount(UiSheet, {
      props: { open: false, title: 'b', back: 'Back' },
      global: global(),
      attachTo: document.body,
    });
    const plain = sheet('c');
    const backdrop = (title: string) =>
      [...document.querySelectorAll<HTMLElement>('.backdrop')].find(
        (element) => element.querySelector('h2')?.textContent === title,
      );
    await under.setProps({ open: true });
    await over.setProps({ open: true });
    expect(backdrop('a')?.classList).toContain('covered');
    expect(backdrop('a')?.hasAttribute('inert')).toBe(true);
    expect(backdrop('b')?.classList).not.toContain('covered');
    await over.setProps({ open: false });
    expect(backdrop('a')?.classList).not.toContain('covered');
    expect(backdrop('a')?.hasAttribute('inert')).toBe(false);
    await plain.setProps({ open: true });
    expect(backdrop('a')?.classList).not.toContain('covered');
    under.unmount();
    over.unmount();
    plain.unmount();
  });

  // Every sheet that is closed fades out, with nothing in it to press meanwhile, and is gone once
  // it has; one with a way back that the viewer goes back from slides away instead. A sheet opened
  // again on its way out is there once, at once. The transition is the real one here, not the stub
  // that the tests otherwise put in its place.
  test('fades out when closed, and slides away only as the viewer goes back', async () => {
    const open = (back: string | null) =>
      mount(UiSheet, {
        props: { open: true, title: 'x', back },
        global: { ...global(), stubs: { transition: false } },
        attachTo: document.body,
      });
    const dialogs = () => document.querySelectorAll('[role=dialog]');
    const plain = open(null);
    await plain.setProps({ open: false });
    expect(document.querySelector('.backdrop.sheet-leave-active [role=dialog]')).not.toBeNull();
    await vi.waitFor(() => expect(dialogs()).toHaveLength(0));
    await plain.setProps({ open: true });
    await plain.setProps({ open: false });
    await plain.setProps({ open: true });
    expect(dialogs()).toHaveLength(1);
    expect(document.querySelector('.backdrop.sheet-leave-active')).toBeNull();
    plain.unmount();
    const page = open('Back');
    await page.setProps({ open: false });
    expect(document.querySelector('.backdrop.sheet-leave-active [role=dialog]')).not.toBeNull();
    await vi.waitFor(() => expect(dialogs()).toHaveLength(0));
    await page.setProps({ open: true });
    document.querySelector<HTMLButtonElement>('[role=dialog] button.back')?.click();
    await page.setProps({ open: false });
    expect(document.querySelector('.backdrop.slide-out [role=dialog]')).not.toBeNull();
    page.unmount();
  });

  // The button that opened the sheet may be in a bar that stays at the top of the screen, as the
  // room menu's is: the focus goes back to it without the page being scrolled to where the bar
  // stands on it.
  test('gives the focus back to what opened it, without scrolling, when it closes', async () => {
    const button = document.createElement('button');
    button.id = 'opener';
    document.body.append(button);
    button.focus();
    const focus = vi.spyOn(button, 'focus');
    const wrapper = sheet('d', true);
    await nextTick();
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
    await wrapper.setProps({ open: false });
    expect(active()).toBe('opener');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    wrapper.unmount();
    button.remove();
  });

  test('gives the focus back when it is taken off the page open, as when it is closed', async () => {
    const button = document.createElement('button');
    button.id = 'opener';
    document.body.append(button);
    button.focus();
    const focus = vi.spyOn(button, 'focus');
    const wrapper = sheet('e', true);
    await nextTick();
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
    wrapper.unmount();
    expect(active()).toBe('opener');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    button.remove();
  });

  test('takes the keys and the focus when it is created open', async () => {
    const wrapper = sheet('c', true);
    await nextTick();
    expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
    press('Escape');
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  // A switch, such as the one for the sounds in the room menu, is armed by the space bar as a
  // button is: the focus goes past it, to a field to type in or else to the panel.
  test('gives the focus to the first field to type in, and never to a checkbox', async () => {
    const open = (inputs: (() => ReturnType<typeof h>)[]) =>
      mount(UiSheet, {
        props: { open: false, title: 'd' },
        slots: { default: () => inputs.map((input) => input()) },
        global: global(),
        attachTo: document.body,
      });
    const checkbox = () => h('input', { type: 'checkbox', id: 'mute' });
    const field = () => h('input', { type: 'text', id: 'name' });
    const switchOnly = open([checkbox]);
    await switchOnly.setProps({ open: true });
    await nextTick();
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
    switchOnly.unmount();
    const withField = open([checkbox, field]);
    await withField.setProps({ open: true });
    await nextTick();
    expect(active()).toBe('name');
    withField.unmount();
  });
});

// The press of a sticker (base.css): on a computer, a hover lifts it a pixel, with its shadow a
// pixel longer; a press pushes it into its shadow, the same on every sticker that can be pressed.
describe('the press of a sticker', () => {
  test('is on every button but a quiet one', () => {
    const variants = ['secondary', 'primary', 'danger', 'quiet'] as const;
    const classes = variants.map((variant) =>
      mount(UiButton, { props: { variant }, slots: { default: 'Go' }, global: global() })
        .get('button')
        .classes(),
    );
    expect(classes.map((names) => names.includes('press'))).toEqual([true, true, true, false]);
    // A link that looks like a button too.
    const link = mount(UiButton, { props: { href: '/account' }, slots: { default: 'Go' }, global: global() });
    expect(link.get('a').classes()).toContain('press');
  });

  test('moves the avatar of a button that opens a panel, and nothing that opens none', () => {
    const opens = mount(AvatarButton, { props: { handle: 'b0b000000000', name: 'Bob' }, global: global() });
    expect(opens.get('button').classes()).toContain('press-host');
    expect(opens.get('.avatar').classes()).toContain('press-part');
    const still = mount(AvatarButton, { props: { playerId: 'b', name: 'Bob' }, global: global() });
    expect(still.find('.press-host').exists()).toBe(false);
    expect(still.get('.avatar').classes()).not.toContain('press-part');
  });

  test('is on the two cards of the choice of language, which press as far as their shadow goes', () => {
    const gate = mount(LanguageGate, { global: global() });
    const choices = gate.findAll('button.choice');
    expect(choices).toHaveLength(2);
    expect(choices.every((choice) => choice.classes('press') && choice.classes('press-large'))).toBe(true);
  });
});
