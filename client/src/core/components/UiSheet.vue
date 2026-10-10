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
// which older in-app browsers lack. Focus goes to its first input, or to the panel itself when
// there is none, so that no button is armed by opening it; Tab then stays inside the panel. A
// sheet opened from another one, such as the chair's menu from the groups on a phone, lies over
// it, and only the sheet on top listens to the keys.
const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
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
      (panel.value?.querySelector<HTMLElement>('input') ?? panel.value)?.focus();
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
      <section ref="panel" class="panel" role="dialog" aria-modal="true" :aria-labelledby="id" tabindex="-1">
        <header class="head">
          <h2 :id="id">{{ title }}</h2>
          <button type="button" class="close" :aria-label="t('room.close')" @click="emit('close')">&times;</button>
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
  font-size: var(--text-2xl);
}

.close {
  flex: none;
  width: 44px;
  height: 44px;
  border: var(--line) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
  color: var(--ink);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.close:active {
  background: var(--bg);
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
