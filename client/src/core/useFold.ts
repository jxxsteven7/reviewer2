import type { BaseTransitionProps } from 'vue';

// How a folded part of a sticker opens and closes (FoldedList.vue, FieldFold.vue): its height
// eases from nothing to what it takes, with its padding and, fading, its content, and back again
// as it closes. These are the hooks of a <Transition> with no CSS of its own, around the part that
// `v-show` folds: the height is measured, since CSS can't ease to `auto` everywhere yet, and set in
// the element's own style for the move alone. A fold toggled while it moves goes on from where it
// is. Where the device asks for less motion, the part is simply there, or gone.

const DURATION = 220;
const MOVING = ['height', 'padding-top', 'padding-bottom', 'opacity'];
// What stops the move of an element on its way, without touching its style.
const stops = new WeakMap<Element, () => void>();

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function clear(el: HTMLElement) {
  stops.get(el)?.();
  stops.delete(el);
  for (const property of [...MOVING, 'overflow', 'transition']) el.style.removeProperty(property);
}

function ease(el: unknown, opening: boolean, done: () => void) {
  if (!(el instanceof HTMLElement)) {
    done();
    return;
  }
  const moving = stops.has(el);
  stops.get(el)?.();
  stops.delete(el);
  if (reduced()) {
    clear(el);
    done();
    return;
  }
  // Where the part stands: as it is when open, or part of the way when it was already moving,
  // read before the move is stopped, which would jump it to the end. Then the height it takes
  // when open, measured without the height of the move.
  const style = getComputedStyle(el);
  const at = {
    height: `${el.getBoundingClientRect().height}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    opacity: style.opacity,
  };
  el.style.transition = 'none';
  el.style.overflow = 'hidden';
  for (const property of MOVING) el.style.removeProperty(property);
  const full = `${el.getBoundingClientRect().height}px`;
  if (opening && !moving) {
    el.style.height = '0';
    el.style.paddingTop = '0';
    el.style.paddingBottom = '0';
    el.style.opacity = '0';
  } else {
    Object.assign(el.style, at);
  }
  void el.offsetHeight;
  el.style.transition = MOVING.map((property) => `${property} ${DURATION}ms var(--ease-out)`).join(', ');
  if (opening) {
    el.style.height = full;
    el.style.removeProperty('padding-top');
    el.style.removeProperty('padding-bottom');
    el.style.opacity = '1';
  } else {
    el.style.height = '0';
    el.style.paddingTop = '0';
    el.style.paddingBottom = '0';
    el.style.opacity = '0';
  }
  // The end of the move: the transition's end, or a timer a little after it, whichever is first.
  const end = () => {
    clear(el);
    done();
  };
  const onEnd = (event: TransitionEvent) => {
    if (event.target === el && event.propertyName === 'height') end();
  };
  el.addEventListener('transitionend', onEnd);
  const timer = setTimeout(end, DURATION + 50);
  stops.set(el, () => {
    el.removeEventListener('transitionend', onEnd);
    clearTimeout(timer);
  });
}

export function useFold(): Pick<BaseTransitionProps, 'onEnter' | 'onLeave'> {
  return {
    onEnter: (el, done) => ease(el, true, done),
    onLeave: (el, done) => ease(el, false, done),
  };
}
