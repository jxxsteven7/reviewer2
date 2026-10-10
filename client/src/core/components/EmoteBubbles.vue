<script setup lang="ts">
import { bubbles } from '../emotes';
import PlayerAvatar from './PlayerAvatar.vue';

// The quick reactions as they arrive, "Name: phrase", with the sender's avatar, at the top of the
// page for a few seconds, over the masthead rather than the banner below it, which says whose move
// it is. They let every tap through to the page underneath. `large` is for a big screen across a
// room.
defineProps<{ large?: boolean }>();
</script>

<template>
  <TransitionGroup tag="div" name="bubble" class="bubbles" :class="{ large }" aria-live="polite">
    <i18n-t v-for="bubble in bubbles" :key="bubble.id" keypath="emotes.bubble" tag="p" class="bubble" scope="global">
      <template #name>
        <PlayerAvatar :name="bubble.name" :avatar="bubble.avatar" />
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
  padding: var(--space-2) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  overflow-wrap: anywhere;
}

.bubble :deep(.avatar) {
  margin-right: var(--space-1);
  vertical-align: -0.45em;
}

.large {
  width: min(48rem, calc(100% - 2 * var(--space-5)));
}

.large .bubble {
  padding: var(--space-3) var(--space-5);
  border-width: var(--line-strong);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-2);
  font-size: var(--text-xl);
}

.bubble-enter-active,
.bubble-leave-active {
  transition:
    opacity var(--motion),
    transform var(--motion);
}

.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
