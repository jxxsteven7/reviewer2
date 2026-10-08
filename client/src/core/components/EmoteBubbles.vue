<script setup lang="ts">
import { bubbles } from '../emotes';

// The quick reactions as they arrive, "Name: phrase", at the top of the page for a few seconds,
// over the masthead rather than the banner below it, which says whose move it is. They let every
// tap through to the page underneath. `large` is for a big screen across a room.
defineProps<{ large?: boolean }>();
</script>

<template>
  <TransitionGroup tag="div" name="bubble" class="bubbles" :class="{ large }" aria-live="polite">
    <i18n-t v-for="bubble in bubbles" :key="bubble.id" keypath="emotes.bubble" tag="p" class="bubble" scope="global">
      <template #name>
        <strong>{{ bubble.name }}</strong>
      </template>
      <template #phrase>{{ $t(`emotes.phrases.${bubble.emote}`) }}</template>
    </i18n-t>
  </TransitionGroup>
</template>

<style scoped>
/* The toasts, which are rarer and say what went wrong, go over them. */
.bubbles {
  position: fixed;
  top: max(var(--space-2), calc(env(safe-area-inset-top) + var(--space-1)));
  left: 50%;
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  width: min(28rem, calc(100% - 2 * var(--space-4)));
  transform: translateX(-50%);
  pointer-events: none;
}

.bubble {
  max-width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.large {
  width: min(48rem, calc(100% - 2 * var(--space-5)));
}

.large .bubble {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-xl);
}

.bubble-enter-active,
.bubble-leave-active {
  transition: opacity 0.2s;
}

.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
}
</style>
