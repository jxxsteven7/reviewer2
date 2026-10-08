<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

// A panel over the page: a sheet from the bottom on phones, a dialog on wider screens. Escape,
// the close button and a tap outside close it. It is written by hand rather than with <dialog>,
// which older in-app browsers lack. Focus goes to its first input, or to the panel itself when
// there is none, so that no button is armed by opening it; Tab then stays inside the panel.
const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const id = useId();
const panel = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;

const FOCUSABLE = 'input, textarea, button, [href], [tabindex]:not([tabindex="-1"])';

function onKey(event: KeyboardEvent) {
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

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocus = document.activeElement as HTMLElement | null;
      document.addEventListener('keydown', onKey);
      await nextTick();
      (panel.value?.querySelector<HTMLElement>('input') ?? panel.value)?.focus();
    } else {
      document.removeEventListener('keydown', onKey);
      returnFocus?.focus?.();
    }
  },
);

onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
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
  background: rgb(21 23 28 / 0.35);
}

.panel {
  width: 100%;
  max-height: 85vh;
  max-height: 85dvh;
  overflow-y: auto;
  padding: var(--space-4) var(--space-4) max(var(--space-5), env(safe-area-inset-bottom));
  border-top: 1px solid var(--ink);
  background: var(--paper);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--rule);
}

h2 {
  font-size: var(--text-lg);
}

.close {
  width: 44px;
  height: 44px;
  margin-right: calc(-1 * var(--space-3));
  border: 0;
  background: none;
  color: var(--ink-2);
  font-size: 1.5rem;
  cursor: pointer;
}

@media (min-width: 40rem) {
  .backdrop {
    align-items: center;
  }

  .panel {
    max-width: 28rem;
    border: 1px solid var(--ink);
    border-radius: var(--radius-card);
  }
}
</style>
