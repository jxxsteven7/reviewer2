<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { colorOf, guestColorOf, initialOf } from '../avatar';
import AgentIcon from './AgentIcon.vue';

// A player's avatar, always a circle with an ink outline: the picture that they uploaded, or the
// default one, which is the first character of the name, in ink, on a bright color that the name
// chooses; an AI player's is the robot's head that marks it (AgentIcon), on such a color. A picture
// that can't be loaded, as after the operator took it down, falls back to the default. The name is
// said beside the avatar wherever one shows, so the avatar adds nothing to the text: a screen reader
// skips it, and the initial is drawn by CSS, so that "Eve: ..." doesn't read or copy as "EEve: ...".
// In a room, the avatar of someone the room is waiting for, who is offline or has been invited and
// hasn't come yet, is `waiting`: faded under a white veil, with three grey dots in the middle that
// light up in turn, as a chat shows someone typing (docs/architecture.md#rooms). One too small for
// the dots, as on a card's corner, is only `faded`. An `initial` takes the place of the name's
// first character, for a name whose first character says nothing, as a deleted account's. A
// `guest`, by their number, gets the color of the number rather than of the name, which the page
// gives them in its own language (names.ts): the same color whatever they are called.
const props = withDefaults(
  defineProps<{
    name: string;
    initial?: string | null;
    guest?: number | null;
    avatar?: string | null;
    agent?: boolean;
    size?: 'small' | 'medium' | 'large';
    waiting?: boolean;
    faded?: boolean;
  }>(),
  {
    initial: null,
    guest: null,
    avatar: null,
    agent: false,
    size: 'small',
    waiting: false,
    faded: false,
  },
);
const failed = ref(false);
watch(
  () => props.avatar,
  () => (failed.value = false),
);
const picture = computed(() => (props.avatar && !failed.value ? props.avatar : null));
</script>

<template>
  <span
    class="avatar"
    :class="[size, { veiled: waiting || faded }]"
    aria-hidden="true"
    :style="picture ? undefined : { background: guest === null ? colorOf(name) : guestColorOf(guest) }"
  >
    <img v-if="picture" :src="picture" alt="" @error="failed = true" />
    <AgentIcon v-else-if="agent" class="face" />
    <span v-else class="initial num" :data-initial="initial ?? initialOf(name)"></span>
    <span v-if="waiting" class="wait"><i></i><i></i><i></i></span>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: var(--line-thin) solid var(--ink);
  border-radius: 50%;
  background: var(--paper-2);
  color: var(--ink);
  line-height: 1;
}

.small {
  width: 26px;
  height: 26px;
  font-size: 0.8rem;
}

.medium {
  width: 40px;
  height: 40px;
  border-width: var(--line);
  font-size: 1.125rem;
}

.large {
  width: 96px;
  height: 96px;
  border-width: var(--line-strong);
  font-size: 2.5rem;
}

img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.initial::before {
  content: attr(data-initial);
  font-weight: var(--weight-display);
}

.face {
  width: 70%;
  height: 70%;
}

.veiled {
  position: relative;
  border-color: var(--ink-veiled);
}

.veiled::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--veil);
}

/* Three small dots, a little apart, sized by the avatar's own type. */
.wait {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.12em;
}

.wait i {
  width: 0.24em;
  height: 0.24em;
  border-radius: 50%;
  background: var(--ink-2);
  box-shadow: 0 0 0 1px var(--paper);
  animation: wait 1.4s ease-in-out infinite;
}

.wait i:nth-child(2) {
  animation-delay: 0.2s;
}

.wait i:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes wait {
  0%,
  60%,
  100% {
    opacity: 0.3;
  }

  30% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wait i {
    animation: none;
  }
}
</style>
