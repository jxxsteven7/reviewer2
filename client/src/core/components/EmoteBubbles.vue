<script setup lang="ts">
import { bubbles } from '../emotes';
import PlayerAvatar from './PlayerAvatar.vue';

// The quick reactions as they arrive, "Name: phrase", with the sender's avatar, at the top of the
// page for a few seconds, over the masthead rather than the banner below it, which says whose move
// it is, and the room's calls about a player, louder: ink with the table's yellow, a megaphone and
// the player's avatar before the line. They let every tap through to the page underneath. `large`
// is for a big screen across a room.
defineProps<{ large?: boolean }>();
</script>

<template>
  <TransitionGroup tag="div" name="bubble" class="bubbles" :class="{ large }" aria-live="polite">
    <p v-for="bubble in bubbles" :key="bubble.id" class="bubble" :class="{ call: 'call' in bubble }">
      <template v-if="'call' in bubble">
        <PlayerAvatar :name="bubble.name" :avatar="bubble.avatar" />
        {{ bubble.call }}
      </template>
      <i18n-t v-else keypath="emotes.bubble" tag="span" scope="global">
        <template #name>
          <PlayerAvatar :name="bubble.name" :avatar="bubble.avatar" />
          <strong>{{ bubble.name }}</strong>
        </template>
        <template #phrase>{{ $t(`emotes.phrases.${bubble.emote}`) }}</template>
      </i18n-t>
    </p>
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

/* A call, which the whole room is meant to notice: ink, flat as ink is, with yellow type, bigger,
   after a megaphone that is for the eye alone. The first declaration of the pair is for the
   browsers that don't know the form with the alternative text. */
.call {
  padding: var(--space-3) var(--space-4);
  border-width: var(--line-strong);
  background: var(--ink);
  box-shadow: none;
  color: var(--on-ink);
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-display);
  font-synthesis: none;
  line-height: 1.3;
  text-align: center;
}

.call::before {
  content: '\1F4E2  ';
  content: '\1F4E2  ' / '';
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

.large .call {
  box-shadow: none;
  font-size: var(--text-2xl);
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
