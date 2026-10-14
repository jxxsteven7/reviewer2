<script lang="ts">
// The sheets that are open on the page, the one on top last. Shared by every sheet, which is why
// it lives outside the setup: each instance has its own copy of what is declared there.
const openSheets: symbol[] = [];
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
// the keys.
//
// A sheet with a way `back`, named by that text, has a round button with an arrow before its title,
// as the close button has its cross after it, which takes the viewer back to the sheet it was
// opened from.
//
// A `subtitle` follows the title in small grey type, as a friend's username follows the name the
// account gives them.
//
// A sheet that isn't to `focusInput` takes the focus itself as it opens, so that a phone shows no
// keyboard before the viewer asks for one, as a chat opened only to read it. A sheet that is to
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
// The subtitle as it follows the title, a space apart, so that the heading reads as two words.
const spacedSubtitle = computed(() => ` ${props.subtitle ?? ''}`);
let returnFocus: HTMLElement | null = null;
const screen = useVisualViewport(computed(() => props.open && props.fitScreen));
const placed = computed(() =>
  screen.value ? { top: `${screen.value.top}px`, height: `${screen.value.height}px`, bottom: 'auto' } : undefined,
);

const FOCUSABLE = 'input, textarea, button, [href], [tabindex]:not([tabindex="-1"])';

const me = Symbol('sheet');
function leave() {
  const at = openSheets.indexOf(me);
  if (at >= 0) openSheets.splice(at, 1);
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
      returnFocus = document.activeElement as HTMLElement | null;
      openSheets.push(me);
      document.addEventListener('keydown', onKey);
      await nextTick();
      const input = props.focusInput ? panel.value?.querySelector<HTMLElement>('input:not([type="checkbox"])') : null;
      (input ?? panel.value)?.focus();
    } else if (was) {
      leave();
      document.removeEventListener('keydown', onKey);
      returnFocus?.focus?.();
    }
  },
  { immediate: true },
);

// A sheet taken off the page while it is open, with the part that holds it, gives the focus back
// as a closed one does, so that it doesn't fall to the top of the page.
onBeforeUnmount(() => {
  leave();
  document.removeEventListener('keydown', onKey);
  if (props.open) returnFocus?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="backdrop" :style="placed" @click.self="emit('close')">
      <section
        ref="panel"
        class="panel"
        :class="{ fit: fitScreen }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="id"
        tabindex="-1"
      >
        <div class="scroller">
          <header class="head">
            <button v-if="back" type="button" class="round back" :aria-label="back" @click="emit('back')">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4.5 7.5 12l7.5 7.5" /></svg>
            </button>
            <h2 :id="id">
              {{ title }}<small v-if="subtitle" class="subtitle">{{ spacedSubtitle }}</small>
            </h2>
            <button type="button" class="round close" :aria-label="t('room.close')" @click="emit('close')">
              &times;
            </button>
          </header>
          <div class="body"><slot /></div>
        </div>
      </section>
    </div>
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

/* What scrolls is inside the panel, a little below its top edge and, where it is round, above its
   bottom edge, so that the scrollbar stays clear of the round corners rather than running over
   them. Its padding makes up the rest of the panel's space around the content, and at the top
   leaves room for the focus ring of the head's buttons, which would otherwise be clipped. */
.scroller {
  flex: 1 1 auto;
  min-height: 0;
  margin-top: var(--space-2);
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

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

h2 {
  flex: 1;
  min-width: 0;
  font-size: var(--text-2xl);
}

.subtitle {
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

/* The round buttons at either end of the title: back, with its arrow, and close, with its cross. */
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
  color: var(--ink);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.round:active {
  background: var(--bg);
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

.fit .head {
  flex: none;
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

  .scroller {
    margin: var(--space-3) 0 var(--space-4);
    padding: var(--space-2) var(--space-5) var(--space-1);
  }
}
</style>
