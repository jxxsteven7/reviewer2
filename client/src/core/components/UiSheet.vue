<script lang="ts">
// The sheets that are open on the page, the one on top last. Shared by every sheet, which is why
// it lives outside the setup: each instance has its own copy of what is declared there.
const openSheets: symbol[] = [];
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

// A panel over the page: a sheet from the bottom on phones, a dialog on wider screens. Escape,
// the close button and a tap outside close it. It is written by hand rather than with <dialog>,
// which older in-app browsers lack. Focus goes to its first input other than a checkbox, or to the
// panel itself when there is none, so that no button or switch, such as the one for the sounds, is
// armed by opening it; Tab then stays inside the panel. A sheet opened from another one, such as
// the chair's menu from the groups on a phone, lies over it, and only the sheet on top listens to
// the keys.
//
// A `tall` sheet is as tall as a sheet may be, however much it holds, and scrolls inside, as a page
// shown over the one below. A sheet with a way `back`, named by that text, has a round button with
// an arrow before its title, as the close button has its cross after it, which takes the viewer
// back to the sheet it was opened from.
const props = withDefaults(defineProps<{ open: boolean; title: string; tall?: boolean; back?: string | null }>(), {
  tall: false,
  back: null,
});
const emit = defineEmits<{ close: []; back: [] }>();
const { t } = useI18n();
const id = useId();
const panel = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;

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
      (panel.value?.querySelector<HTMLElement>('input:not([type="checkbox"])') ?? panel.value)?.focus();
    } else if (was) {
      leave();
      document.removeEventListener('keydown', onKey);
      returnFocus?.focus?.();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  leave();
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="backdrop" @click.self="emit('close')">
      <section
        ref="panel"
        class="panel"
        :class="{ tall }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="id"
        tabindex="-1"
      >
        <header class="head">
          <button v-if="back" type="button" class="round back" :aria-label="back" @click="emit('back')">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 4.5 7.5 12l7.5 7.5" /></svg>
          </button>
          <h2 :id="id">{{ title }}</h2>
          <button type="button" class="round close" :aria-label="t('room.close')" @click="emit('close')">
            &times;
          </button>
        </header>
        <div class="body"><slot /></div>
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
  width: 100%;
  max-height: 88vh;
  max-height: 88dvh;
  overflow-y: auto;
  padding: var(--space-4) var(--space-4) max(var(--space-5), env(safe-area-inset-bottom));
  border: var(--line-strong) solid var(--ink);
  border-bottom: 0;
  border-radius: var(--radius-hero) var(--radius-hero) 0 0;
  background: var(--paper);
  animation: rise var(--motion) ease-out;
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

.panel.tall {
  height: 88vh;
  height: 88dvh;
}

@media (min-width: 40rem) {
  .backdrop {
    align-items: center;
    padding: var(--space-5);
  }

  .panel {
    max-width: 30rem;
    padding: var(--space-5);
    border-bottom: var(--line-strong) solid var(--ink);
    border-radius: var(--radius-hero);
    box-shadow: var(--shadow-3);
  }
}
</style>
