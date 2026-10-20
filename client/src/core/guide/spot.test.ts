// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { spot, useSpot, WIDE, type SpotTarget } from './spot';

// A scene with a part in it, which the finger is put on.
const Scene = defineComponent({
  props: { target: { type: Object as () => SpotTarget | null, default: null } },
  setup(props) {
    const root = ref<HTMLElement | null>(null);
    useSpot(root, () => props.target);
    return () => h('div', { ref: root, class: 'scene' }, [h('button', { class: 'part' }, 'Tap me')]);
  },
});

// Where the chapter's bar ends and the coach card begins on the screen, and where the part is.
const BAR_BOTTOM = 60;
const COACH_TOP = 300;
const PART_TOP = 400;
const PART_HEIGHT = 40;
const SCREEN_HEIGHT = 600;

function box(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top } as DOMRect;
}

let scrolled: ReturnType<typeof vi.fn>;
let wide = false;

beforeEach(() => {
  const bar = document.createElement('header');
  bar.className = 'guide-bar';
  bar.getBoundingClientRect = () => box(0, BAR_BOTTOM);
  const coach = document.createElement('section');
  coach.className = 'guide-coach';
  coach.getBoundingClientRect = () => box(COACH_TOP, SCREEN_HEIGHT - COACH_TOP);
  document.body.append(bar, coach);
  Object.defineProperty(window, 'innerHeight', { value: SCREEN_HEIGHT, configurable: true });
  scrolled = vi.fn();
  window.scrollTo = scrolled as unknown as typeof window.scrollTo;
  wide = false;
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) => ({ matches: query === WIDE && wide, media: query }) as MediaQueryList,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  spot.value = null;
});

async function placed(target: SpotTarget | null) {
  const wrapper = mount(Scene, { props: { target }, attachTo: document.body });
  const part = wrapper.get('.part').element as HTMLElement;
  part.getBoundingClientRect = () => box(PART_TOP, PART_HEIGHT);
  return wrapper;
}

describe('the spot of the finger', () => {
  test('is the part of the scene that the step names, with what the finger does there, and none without one', async () => {
    const wrapper = await placed({ selector: '.part', finger: 'tap' });
    await vi.waitFor(() => expect(spot.value).not.toBeNull());
    expect(spot.value?.el).toBe(wrapper.get('.part').element);
    expect(spot.value?.finger).toBe('tap');
    await wrapper.setProps({ target: { selector: '.nothing', finger: 'point' } });
    expect(spot.value).toBeNull();
    await wrapper.setProps({ target: null });
    expect(spot.value).toBeNull();
    wrapper.unmount();
  });

  test('goes with its scene', async () => {
    const wrapper = await placed({ selector: '.part', finger: 'point' });
    await vi.waitFor(() => expect(spot.value).not.toBeNull());
    wrapper.unmount();
    expect(spot.value).toBeNull();
  });

  // On a phone the coach card lies over the bottom of the screen, however tall it is, and the part
  // comes to the middle of what the bar and the card leave; on a wider screen the card is beside
  // the scene, and the part comes to the middle of what is under the bar.
  test('brings the part to the middle of the screen between the bar and the coach card, or under the bar on a wide screen', async () => {
    const middle = PART_TOP + PART_HEIGHT / 2;
    const phone = await placed({ selector: '.part', finger: 'tap' });
    await vi.waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled).toHaveBeenLastCalledWith({ top: middle - (BAR_BOTTOM + COACH_TOP) / 2, behavior: 'smooth' });
    phone.unmount();

    wide = true;
    scrolled.mockClear();
    const computer = await placed({ selector: '.part', finger: 'tap' });
    await vi.waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled).toHaveBeenLastCalledWith({ top: middle - (BAR_BOTTOM + SCREEN_HEIGHT) / 2, behavior: 'smooth' });
    computer.unmount();
  });
});
