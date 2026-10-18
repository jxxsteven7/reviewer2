<script setup lang="ts">
import PlayerAvatar from '../../core/components/PlayerAvatar.vue';

// The chair's invitation of an AI player to a seat of the waiting room
// (docs/games/keywords.md#ai-players): one button, a beige chip on the row where the player would
// sit, which stands out beside the seats' white buttons. In it, the AI player's avatar is a sticker
// with the small hard shadow of what can be pressed, which lifts and presses as a player's avatar
// does (`press-part` in base.css, which also keeps it still where the device asks for less
// motion), with a plus on its corner, which tells the invitation from the AI player once seated,
// whose avatar opens its page; and the words, in which the AI player's name never breaks over two
// lines. Its name to a screen reader is the words.
defineProps<{ name: string }>();
defineEmits<{ click: [] }>();
</script>

<template>
  <button type="button" class="invite-agent press-host" @click="$emit('click')">
    <span class="face press-part">
      <PlayerAvatar :name="name" agent />
      <span class="plus"></span>
    </span>
    <i18n-t keypath="lobby.inviteAgent" tag="span" class="words" scope="global">
      <template #name>
        <span class="name">{{ name }}</span>
      </template>
    </i18n-t>
  </button>
</template>

<style scoped>
.invite-agent {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  margin-left: calc(-1 * var(--space-1));
  padding: var(--space-1) var(--space-4) var(--space-1) var(--space-1);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--paper-2);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
  text-align: start;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color var(--motion),
    box-shadow var(--motion);
}

@media (hover: hover) {
  .invite-agent:hover {
    background: var(--neutral-tint);
    box-shadow: inset 0 0 0 var(--line-thin) var(--neutral);
  }
}

.face {
  position: relative;
  display: inline-flex;
  flex: none;
  border-radius: 50%;
  box-shadow: var(--shadow-1);
}

/* The plus: an ink disc with a paper edge on the avatar's lower right, its bars two paper lines. */
.plus {
  position: absolute;
  right: -5px;
  bottom: -4px;
  width: 15px;
  height: 15px;
  border: 1.5px solid var(--paper);
  border-radius: 50%;
  background:
    linear-gradient(var(--paper), var(--paper)) center / 7px 2px no-repeat,
    linear-gradient(var(--paper), var(--paper)) center / 2px 7px no-repeat,
    var(--ink);
}

.name {
  white-space: nowrap;
}
</style>
