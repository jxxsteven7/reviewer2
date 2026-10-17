<script lang="ts">
import { shallowReactive } from 'vue';

// The sheets that are open on the page, the one on top last, and those of them with a way back.
// Shared by every sheet, which is why they live outside the setup: each instance has its own copy of
// what is declared there.
const openSheets = shallowReactive<symbol[]>([]);
const sheetsWithBack = shallowReactive(new Set<symbol>());
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useVisualViewport } from '../useVisualViewport';

// A panel over the page: a sheet from the bottom on phones, a dialog on wider screens. Escape,
// the close button and a tap outside close it. It is written by hand rather than with <dialog>,
// which older in-app browsers lack. Focus goes to its first input other than a checkbox, or to the
// panel itself when there is none, so that no button or switch, such as the one for the sounds, is
// armed by opening it; Tab then stays inside the panel. A sheet opened from another one, such as
// the chair's menu from the groups on a phone, lies over it, and only the sheet on top listens to
// the keys. Sheets lie in the order they were opened, whatever their order on the page: the
// player's panel, which a room puts on the page as it is entered, lies over the groups, which come
// only with the game, when it is opened from them. They all stay under the emotes, the toasts and
// the menu of marks.
//
// A sheet with a way `back`, named by that text, has a round button with an arrow before its title,
// as the close button has its cross after it, which takes the viewer back to the sheet it was
// opened from. That sheet, right under it, needs no showing meanwhile: it is hidden, scrim and all,
// out of reach of the keys and of assistive technology, and comes back as it was, where it was
// scrolled to, once the viewer goes back (docs/design.md). The sheet with the way back slides up
// from the bottom on a phone, and rises a little into place as a dialog, while the one under it
// fades out; going back, it slides down again while the one under it fades in.
//
// Every sheet comes with its panel rising as the scrim fades in, and, closed, sinks a little and
// fades out while the scrim fades, quicker than it came (--motion-quick); nothing in it can be
// pressed meanwhile, and the focus has already gone back. A sheet opened again while it is on its
// way out is there at once, as Vue cuts the leave short. Where the device asks for less motion,
// base.css makes every one of these moves instant.
//
// A `subtitle` follows the title in small grey type (.username-after in base.css), as a friend's
// username follows the name the account gives them.
//
// A sheet that isn't to `focusInput` takes the focus itself as it opens, so that a phone shows no
// keyboard before the viewer asks for one, as a chat opened only to read it. As it closes, the
// focus goes back to what opened it, without scrolling: the button was in sight a moment ago, and
// one in a bar that stays at the top of the screen, as the room menu's, would otherwise have the
// browser scroll the page to where the bar stands on it, below the scroll padding. A sheet that is to
// `fitScreen` keeps to the part of the screen that a phone's keyboard leaves (useVisualViewport.ts)
// and holds its content in a column as tall as it may be, so that what the content keeps at its
// foot, such as the line a player writes, stays in sight above the keyboard while the rest
// scrolls.
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    back?: string | null;
    subtitle?: string | null;
    focusInput?: boolean;
    fitScreen?: boolean;
  }>(),
  { back: null, subtitle: null, focusInput: true, fitScreen: false },
);
const emit = defineEmits<{ close: []; back: [] }>();
const { t } = useI18n();
const id = useId();
const panel = ref<HTMLElement | null>(null);
// Whether what scrolls in the panel has left its top: the content, or a list of its own, as the
// chat's thread in a sheet fitted to the screen. Scroll events don't bubble, so the panel hears them
// as they go down to their target; a list that scrolls sideways leaves the content as it was.
const scroller = ref<HTMLElement | null>(null);
const scrolled = ref(false);
const onScroll = (event: Event) => {
  const list = event.target instanceof HTMLElement && event.target !== scroller.value ? event.target : null;
  scrolled.value = (scroller.value?.scrollTop ?? 0) > 0 || (list?.scrollTop ?? 0) > 0;
};
// The subtitle as it follows the title, a space apart, so that the heading reads as two words.
const spacedSubtitle = computed(() => ` ${props.subtitle ?? ''}`);
let returnFocus: HTMLElement | null = null;
const screen = useVisualViewport(computed(() => props.open && props.fitScreen));
const me = Symbol('sheet');
// From 20, the layer of a sheet that is alone, to 24, under the emotes' 25 (EmoteBubbles.vue).
const layer = computed(() => 20 + Math.min(Math.max(openSheets.indexOf(me), 0), 4));
// Whether the sheet right over this one has a way back, which leads here.
const covered = computed(() => {
  const above = openSheets[openSheets.indexOf(me) + 1];
  return openSheets.includes(me) && above !== undefined && sheetsWithBack.has(above);
});
// Whether the viewer went back from this sheet, which then slides away, rather than closing it.
const wentBack = ref(false);
const placed = computed(() => ({
  zIndex: layer.value,
  ...(screen.value ? { top: `${screen.value.top}px`, height: `${screen.value.height}px`, bottom: 'auto' } : {}),
}));

const FOCUSABLE = 'input, textarea, button, [href], [tabindex]:not([tabindex="-1"])';

function leave() {
  const at = openSheets.indexOf(me);
  if (at >= 0) openSheets.splice(at, 1);
  sheetsWithBack.delete(me);
}

// The focus goes back to what opened the sheet. What opened a sheet with a way back is in the sheet
// under it, hidden until the page has drawn it again.
function giveFocusBack() {
  const target = returnFocus;
  if (target?.closest('.covered')) void nextTick(() => target.focus({ preventScroll: true }));
  else target?.focus?.({ preventScroll: true });
}

function goBack() {
  wentBack.value = true;
  emit('back');
}

function onKey(event: KeyboardEvent) {
  if (openSheets.at(-1) !== me) return;
  if (event.key === 'Escape') {
    emit('close');
    return;
  }
  if (event.key !== 'Tab' || !panel.value) return;
  const elements = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled'),
  );
  const first = elements[0];
  const last = elements.at(-1);
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    panel.value.focus();
  } else if (event.shiftKey && (active === first || active === panel.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  } else if (!panel.value.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

// Immediate, so that a sheet that is created open, by a parent that renders it only at some
// widths, takes the keys and the focus like one that opens later.
watch(
  () => props.open,
  async (open, was) => {
    if (open) {
      scrolled.value = false;
      wentBack.value = false;
      returnFocus = document.activeElement as HTMLElement | null;
      openSheets.push(me);
      if (props.back) sheetsWithBack.add(me);
      document.addEventListener('keydown', onKey);
      await nextTick();
      const input = props.focusInput ? panel.value?.querySelector<HTMLElement>('input:not([type="checkbox"])') : null;
      (input ?? panel.value)?.focus();
    } else if (was) {
      leave();
      document.removeEventListener('keydown', onKey);
      giveFocusBack();
    }
  },
  { immediate: true },
);

// A sheet taken off the page while it is open, with the part that holds it, gives the focus back
// as a closed one does, so that it doesn't fall to the top of the page.
onBeforeUnmount(() => {
  leave();
  document.removeEventListener('keydown', onKey);
  if (props.open) giveFocusBack();
});
</script>

<template>
  <Teleport to="body">
    <!-- A sheet with a way back slides in and, going back, out, with the scrim as it is; every other
         sheet comes with its scrim fading in, and every sheet that is closed sinks and fades out. -->
    <Transition
      name="sheet"
      :enter-active-class="back ? 'slide-in' : undefined"
      :leave-active-class="wentBack ? 'slide-out' : undefined"
    >
      <div
        v-if="open"
        class="backdrop"
        :class="{ 'with-back': back, covered }"
        :style="placed"
        :inert="covered || undefined"
        @click.self="emit('close')"
      >
        <section
          ref="panel"
          class="panel"
          :class="{ fit: fitScreen }"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="id"
          tabindex="-1"
          @scroll.capture.passive="onScroll"
        >
          <header class="head" :class="{ scrolled }">
            <button v-if="back" type="button" class="round back press" :aria-label="back" @click="goBack">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4.5 7.5 12l7.5 7.5" /></svg>
            </button>
            <h2 :id="id">
              {{ title }}<small v-if="subtitle" class="subtitle username-after">{{ spacedSubtitle }}</small>
            </h2>
            <button type="button" class="round close press" :aria-label="t('room.close')" @click="emit('close')">
              &times;
            </button>
          </header>
          <div ref="scroller" class="scroller">
            <div class="body"><slot /></div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: var(--scrim);
}

.panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 88vh;
  max-height: 88dvh;
  overflow: hidden;
  border: var(--line-strong) solid var(--ink);
  border-bottom: 0;
  border-radius: var(--radius-hero) var(--radius-hero) 0 0;
  background: var(--paper);
  animation: rise var(--motion) ease-out;
}

/* What scrolls is under the head and, where the panel is round, above its bottom edge, so that
   the scrollbar stays clear of the round corners rather than running over them. Its padding makes
   up the rest of the panel's space around the content. */
.scroller {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2) var(--space-4) max(var(--space-5), env(safe-area-inset-bottom));
}

/* The panel takes the focus when it opens, so that the keyboard and screen readers start inside it,
   but it is no control of its own: it shows no focus ring, which would only draw a second frame
   around the sheet. The buttons and fields inside it keep theirs. */
.panel:focus-visible {
  outline: none;
}

@keyframes rise {
  from {
    transform: translateY(24px);
    opacity: 0;
  }
}

/* The head stays at the top of the panel while the content scrolls under it, with a soft shadow
   under it once the content has scrolled, as under a page's masthead (PageMasthead.vue). Its
   padding leaves room for the focus ring of its buttons, which would otherwise be clipped. */
.head {
  position: relative;
  z-index: 1;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-4) var(--space-2);
}

/* The shadow reaches across the panel's own padding (.panel in base.css), from one side of the
   panel to the other. */
.head::after {
  content: '';
  position: absolute;
  top: 100%;
  right: calc(-1 * var(--space-4));
  left: calc(-1 * var(--space-4));
  height: 12px;
  background: linear-gradient(var(--shade), transparent);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion);
}

.head.scrolled::after {
  opacity: 1;
}

/* A title too long for the head wraps with its lines as even as can be, rather than leaving the
   last word alone on the second line, as "Moves by Guest 1" would leave the number. */
h2 {
  flex: 1;
  min-width: 0;
  font-size: var(--text-2xl);
  text-wrap: balance;
}

/* A sheet with a way back hides the one under it, which it leads back to. That one's scrim goes, as
   the sheet over it has its own; it fades out, and then hides from the keys and assistive technology
   too. Going back, it is there at once and fades in. */
.backdrop.covered {
  background: transparent;
}

.panel {
  transition: opacity var(--motion-sheet-out) ease-out;
}

.covered > .panel {
  visibility: hidden;
  opacity: 0;
  transition:
    opacity var(--motion-sheet-in) ease-out,
    visibility 0s linear var(--motion-sheet-in);
}

/* The scrim fades in as the panel rises. Closed, the panel sinks and fades out while the scrim
   fades, quicker, and nothing in it can be pressed meanwhile. The scrim's own transition is what
   the sheet times itself by; the panel's takes as long. */
.backdrop.sheet-enter-active {
  transition: background-color var(--motion) var(--ease-out);
}

.backdrop.sheet-enter-active.sheet-enter-from {
  background-color: transparent;
}

.backdrop.sheet-leave-active {
  pointer-events: none;
  transition: background-color var(--motion-quick) var(--ease-in);
}

.backdrop.sheet-leave-active.sheet-leave-to {
  background-color: transparent;
}

.sheet-leave-active > .panel {
  transition:
    transform var(--motion-quick) var(--ease-in),
    opacity var(--motion-quick) var(--ease-in);
}

.sheet-leave-active.sheet-leave-to > .panel {
  transform: translateY(24px);
  opacity: 0;
}

/* The sheet with the way back slides up from the bottom instead of rising, and down again as the
   viewer goes back, with the scrim as it is: the one under it goes and comes at the same moment. The
   backdrop's own animation, which changes nothing, is what the transition times itself by. */
.with-back > .panel {
  animation: none;
}

.with-back.slide-in {
  animation: hold var(--motion-sheet-in);
}

.with-back.slide-in > .panel {
  animation: slide-in var(--motion-sheet-in) cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.with-back.slide-out {
  background: transparent;
  pointer-events: none;
  animation: hold var(--motion-sheet-out);
}

.with-back.slide-out > .panel {
  animation: slide-out var(--motion-sheet-out) cubic-bezier(0.4, 0, 1, 1) both;
}

@keyframes hold {
  to {
    opacity: 1;
  }
}

@keyframes slide-in {
  from {
    transform: translateY(100%);
  }
}

@keyframes slide-out {
  to {
    transform: translateY(100%);
  }
}

/* The round buttons at either end of the title: back, with its arrow, and close, with its cross.
   Stickers that can be pressed, with the hard shadow and the press of every one (base.css). */
.round {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: var(--line) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.back svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.4;
}

/* Fitted to the part of the screen that the keyboard leaves: the backdrop is that part, and the
   panel a column of at most 88% of it, whose body holds the content as tall as it may be. */
.panel.fit {
  max-height: 88%;
}

.fit > .scroller {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fit .body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

@media (min-width: 40rem) {
  .backdrop {
    align-items: center;
    padding: var(--space-5);
  }

  .panel {
    max-width: 30rem;
    border-bottom: var(--line-strong) solid var(--ink);
    border-radius: var(--radius-hero);
    box-shadow: var(--shadow-3);
  }

  .head {
    padding: calc(var(--space-3) + var(--space-2)) var(--space-5) var(--space-2);
  }

  .scroller {
    margin-bottom: var(--space-4);
    padding: var(--space-2) var(--space-5) var(--space-1);
  }

  /* A dialog with a way back rises a little into place, and sinks back as the viewer goes back;
     closed, it sinks less far than a sheet does. */
  @keyframes slide-in {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }

  @keyframes slide-out {
    to {
      transform: translateY(40px);
      opacity: 0;
    }
  }

  .sheet-leave-active.sheet-leave-to > .panel {
    transform: translateY(12px);
  }
}
</style>
