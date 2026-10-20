// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { readProgress } from '../guide/progress';
import { i18n, setLanguage } from '../i18n';
import { agents } from '../practice';
import { clearMemory } from '../storage';
import GuidePage from './GuidePage.vue';

vi.mock('../socket', () => ({ connect: vi.fn(), send: vi.fn(), onceConnected: vi.fn() }));
vi.mock('../account', () => ({ account: { loaded: true, summary: null, mail: false }, loadAccount: vi.fn() }));
vi.mock('../../games', () => ({ games: { keywords: {} } }));
// Three chapters of the real ones, with a scene that says where it is and goes on when tapped.
vi.mock('../guide/chapters', async () => {
  const { defineComponent, h } = await import('vue');
  const Scene = defineComponent({
    props: { chapter: { type: String, required: true }, step: { type: Number, required: true } },
    emits: ['next'],
    setup:
      (props, { emit }) =>
      () =>
        h('button', { class: 'scene', type: 'button', onClick: () => emit('next') }, `${props.chapter} ${props.step}`),
  });
  const chapters = [
    { id: 'student', game: 'keywords', steps: 3, scene: Scene, end: { play: 'guesser' } },
    { id: 'settings', game: 'keywords', steps: 2, scene: Scene, end: { next: true } },
    { id: 'feedback', game: null, steps: 2, scene: Scene, end: { try: 'feedback' } },
  ];
  return { chapters, chapterById: (id: string) => chapters.find((chapter) => chapter.id === id) ?? null };
});

const Elsewhere = defineComponent({ render: () => h('p', { class: 'elsewhere' }, 'elsewhere') });

async function opened(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/guide/:chapter?/:step?', component: GuidePage },
      { path: '/:any(.*)*', component: Elsewhere },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    attachTo: document.body,
    global: { plugins: [i18n, router] },
  });
  await flushPromises();
  return { wrapper, router };
}

const press = async (key: string, target: EventTarget = window) => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await flushPromises();
};

beforeEach(() => {
  setLanguage('en', { remember: false });
  localStorage.clear();
  clearMemory();
  agents.value = 'up';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the contents', () => {
  test("list the game's chapters and the site's, each with how far it has been read", async () => {
    const { wrapper } = await opened('/guide');
    expect(wrapper.findAll('.toc-section h2').map((title) => title.text())).toEqual([
      'How to play Double Blind',
      'Using the site',
    ]);
    const chapters = wrapper.findAll('.chapter');
    expect(chapters.map((chapter) => chapter.get('.main').text())).toEqual([
      'Playing a student',
      'Room settings',
      'Giving feedback',
    ]);
    expect(chapters.map((chapter) => chapter.get('.state').text())).toEqual(['3 steps', '2 steps', '2 steps']);
    expect(chapters[1]?.attributes('href')).toBe('/guide/settings/1');
    expect(wrapper.find('.resume').exists()).toBe(false);
    wrapper.unmount();
  });

  test('offer to go on with the chapter read last, where it was left', async () => {
    const reading = await opened('/guide/student/2');
    reading.wrapper.unmount();
    const { wrapper } = await opened('/guide');
    expect(wrapper.get('.resume').attributes('href')).toBe('/guide/student/2');
    expect(wrapper.get('.resume .sub').text()).toBe('Playing a student \u00b7 step 2 of 3');
    expect(wrapper.findAll('.chapter .state').map((state) => state.text())).toEqual([
      'At step 2',
      '2 steps',
      '2 steps',
    ]);
    wrapper.unmount();
  });
});

describe('a chapter', () => {
  test('goes back and on by its buttons, its scene, and the arrow keys, and keeps the step read', async () => {
    const { wrapper, router } = await opened('/guide/student/1');
    expect(wrapper.get('.where').text()).toBe('1. Playing a student');
    expect(wrapper.get('.kicker').text()).toBe('Step 1 of 3');
    expect(wrapper.get('.coach-title').text()).toBe("You're a student");
    expect(wrapper.get('.scene').text()).toBe('student 1');
    expect(wrapper.findAll('.progress .on')).toHaveLength(1);
    const back = () => wrapper.findAll('.nav button')[0];
    expect(back()?.attributes('disabled')).toBeDefined();

    await wrapper.findAll('.nav button')[1]?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/guide/student/2');
    expect(wrapper.get('.scene').text()).toBe('student 2');
    expect(readProgress()).toEqual({ chapters: { student: 2 }, last: 'student' });

    await wrapper.get('.scene').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/guide/student/3');

    await press('ArrowLeft');
    expect(router.currentRoute.value.fullPath).toBe('/guide/student/2');
    await press('ArrowRight');
    expect(router.currentRoute.value.fullPath).toBe('/guide/student/3');
    expect(readProgress().chapters.student).toBe('done');
    await press('Escape');
    expect(router.currentRoute.value.fullPath).toBe('/guide');
    wrapper.unmount();
  });

  test('leaves the keys to a field that is being typed in, and to a panel that is open', async () => {
    const { wrapper, router } = await opened('/guide/student/2');
    const field = document.createElement('input');
    document.body.append(field);
    await press('ArrowRight', field);
    expect(router.currentRoute.value.fullPath).toBe('/guide/student/2');
    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    document.body.append(panel);
    await press('ArrowRight');
    expect(router.currentRoute.value.fullPath).toBe('/guide/student/2');
    wrapper.unmount();
  });

  test('shows its nearest step for a step it has not, and the contents for a chapter that does not exist', async () => {
    const beyond = await opened('/guide/student/99');
    expect(beyond.router.currentRoute.value.fullPath).toBe('/guide/student/3');
    beyond.wrapper.unmount();
    const none = await opened('/guide/student/x');
    expect(none.router.currentRoute.value.fullPath).toBe('/guide/student/1');
    none.wrapper.unmount();
    const unknown = await opened('/guide/nothing/2');
    expect(unknown.router.currentRoute.value.fullPath).toBe('/guide');
    expect(unknown.wrapper.find('.toc').exists()).toBe(true);
    unknown.wrapper.unmount();
  });

  test('leads from its last step to a real game in the role it taught, or on a server without AI players to the next chapter', async () => {
    const { wrapper, router } = await opened('/guide/student/3');
    const finish = () => wrapper.findAll('.nav button')[1];
    expect(finish()?.text()).toBe('Play a real game with Reviewer\u00a01');
    expect(wrapper.get('.to-contents-end').text()).toBe('Back to contents');
    await finish()?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/?practice=guesser');
    wrapper.unmount();

    agents.value = 'none';
    const alone = await opened('/guide/student/3');
    const next = alone.wrapper.findAll('.nav button')[1];
    expect(next?.text()).toBe('Next: Room settings');
    await next?.trigger('click');
    await flushPromises();
    expect(alone.router.currentRoute.value.fullPath).toBe('/guide/settings/1');
    alone.wrapper.unmount();
  });

  test('on feedback ends in the feedback panel itself', async () => {
    const { wrapper } = await opened('/guide/feedback/2');
    const finish = wrapper.findAll('.nav button')[1];
    expect(finish?.text()).toBe('Try it');
    expect(finish?.classes()).toContain('primary');
    await finish?.trigger('click');
    await flushPromises();
    expect(document.querySelector('[role=dialog] h2')?.textContent).toBe('Send feedback');
    wrapper.unmount();
  });

  test('leaves the tutorial for the home page', async () => {
    const { wrapper, router } = await opened('/guide/settings/1');
    expect(wrapper.get('.exit').attributes('aria-label')).toBe('Leave the tutorial');
    await wrapper.get('.exit').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/');
    wrapper.unmount();
  });
});
