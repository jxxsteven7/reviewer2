// @vitest-environment happy-dom
import type { FieldInfo } from '@reviewer2/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n, setLanguage } from '../i18n';
import { chapters } from './chapters';
import { spot, type FingerKind } from './spot';

// Every scene of the tutorial draws every step of its chapter, in both languages, with the part
// that the finger is at found in it, so that a change to the game's or the site's components
// that moves what a step points at is caught here, where the tutorial would otherwise lose its
// finger without a word.

// The page is connected, and the server's word lists have come.
const page = vi.hoisted(() => ({ connection: { connected: true, everConnected: true, connects: 1, refusal: null } }));
vi.mock('../socket', async () => {
  const { computed, reactive } = await import('vue');
  page.connection = reactive(page.connection);
  return {
    send: vi.fn(async () => ({ ok: true })),
    act: vi.fn(async () => ({ ok: true })),
    onceConnected: (run: () => void) => {
      run();
      return () => {};
    },
    socket: { connected: true, on: vi.fn(), once: vi.fn(), off: vi.fn() },
    connection: page.connection,
    reconnecting: computed(() => page.connection.everConnected && !page.connection.connected),
  };
});
vi.mock('../fields', async () => {
  const { shallowRef } = await import('vue');
  const fields: FieldInfo[] = [{ id: 'general', name: { zh: '通用', en: 'General' }, counts: { zh: 400, en: 400 } }];
  return { fields: shallowRef(fields), loadFields: vi.fn() };
});
vi.mock('../account', () => ({
  account: { loaded: true, summary: null, mail: false },
  loadAccount: vi.fn(),
  logIn: vi.fn(),
  request: vi.fn(),
}));

// What the finger does at each step: it taps and holds where the chapters on playing ask the
// reader to, points elsewhere, and is away from the steps that only read.
const TAPS: Record<string, Record<number, FingerKind>> = {
  student: { 3: 'tap', 4: 'tap', 5: 'tap', 6: 'tap', 8: 'hold', 10: 'tap' },
  pi: { 2: 'tap', 4: 'tap' },
};
const NONE: Record<string, number[]> = { rules: [1, 2, 3, 4, 5, 6, 7], student: [12], pi: [8] };
const fingerAt = (chapter: string, step: number): FingerKind | null =>
  NONE[chapter]?.includes(step) ? null : (TAPS[chapter]?.[step] ?? 'point');

const router = () =>
  createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { render: () => null } }] });

beforeEach(() => {
  localStorage.clear();
  document.title = 'Reviewer 2';
});

afterEach(() => {
  spot.value = null;
  document.body.innerHTML = '';
});

describe.each(['en', 'zh'] as const)('the scenes of the tutorial, in %s', (language) => {
  beforeEach(() => setLanguage(language, { remember: false }));

  test.each(chapters.map((chapter) => [chapter.id, chapter] as const))(
    'draw every step of "%s" with the part the finger is at',
    async (id, chapter) => {
      for (let step = 1; step <= chapter.steps; step += 1) {
        const wrapper = mount(chapter.scene, {
          props: { chapter: id, step },
          attachTo: document.body,
          global: { plugins: [i18n, router()] },
        });
        await flushPromises();
        const finger = fingerAt(id, step);
        if (finger === null) {
          expect(spot.value, `${id} ${step}`).toBeNull();
        } else {
          await vi.waitFor(() => expect(spot.value, `${id} ${step}`).not.toBeNull());
          expect(spot.value?.finger, `${id} ${step}`).toBe(finger);
          expect(wrapper.element.contains(spot.value?.el ?? null), `${id} ${step}`).toBe(true);
        }
        // The tutorial's game is invented: it is nobody's turn, and nothing of it is kept, as the
        // group chat keeps what was read in a real game.
        expect(document.title, `${id} ${step}`).toBe('Reviewer 2');
        expect(localStorage.length, `${id} ${step}`).toBe(0);
        wrapper.unmount();
        expect(spot.value).toBeNull();
      }
    },
  );
});
