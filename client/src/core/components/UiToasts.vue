<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { reconnecting } from '../socket';
import { dismiss, toasts } from '../toast';

// Short messages at the top of the screen, and below them whatever else belongs in that column,
// such as the invitations to rooms (InvitationNotices). At the bottom they would cover a sheet's
// input, right where a player just tapped, or sit behind a phone's keyboard. While the
// "Reconnecting..." banner shows at the top, they move down below it. A message slides down a
// little as it comes and up again as it goes, fading either way, and the others move smoothly to
// their places; a message is ink, flat as the ink tags are, and a tap on it, which dismisses it,
// presses it in (press-flat in base.css).
const { t } = useI18n();
</script>

<template>
  <div class="toasts" :class="{ 'under-banner': reconnecting }" role="status" aria-live="polite">
    <TransitionGroup name="toast" tag="div" class="stack">
      <button
        v-for="item in toasts"
        :key="item.id"
        type="button"
        class="toast press press-flat"
        @click="dismiss(item.id)"
      >
        {{ t(item.key, item.params) }}
      </button>
    </TransitionGroup>
    <slot />
  </div>
</template>

<style scoped>
.toasts {
  --toasts-top: max(var(--space-4), calc(env(safe-area-inset-top) + var(--space-3)));

  position: fixed;
  top: var(--toasts-top);
  left: 50%;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(28rem, calc(100% - 2 * var(--space-4)));
  transform: translateX(-50%);
  pointer-events: none;
}

.toasts.under-banner {
  top: calc(var(--toasts-top) + var(--banner-height));
}

/* The messages themselves, which take no room while there are none. A message on its way out is
   taken out of the column, so that the others move up to their places as it fades. */
.stack {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.stack:empty {
  display: none;
}

.toast {
  min-height: 44px;
  padding: var(--space-3) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  text-align: left;
  cursor: pointer;
  pointer-events: auto;
}

.toast-enter-active {
  transition:
    opacity var(--motion) var(--ease-out),
    transform var(--motion) var(--ease-out);
}

.toast-leave-active {
  position: absolute;
  right: 0;
  left: 0;
  pointer-events: none;
  transition:
    opacity var(--motion-quick) var(--ease-in),
    transform var(--motion-quick) var(--ease-in);
}

.toast-enter-from,
.toast-leave-to {
  transform: translateY(-8px);
  opacity: 0;
}

.toast-move {
  transition: transform var(--motion) var(--ease-out);
}
</style>
