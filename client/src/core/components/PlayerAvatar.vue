<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { colorOf, initialOf } from '../avatar';

// A player's avatar, always a circle with an ink outline: the picture that they uploaded, or the
// default one, which is the first character of the name, in ink, on a bright color that the name
// chooses. A picture that can't be loaded, as after the operator took it down, falls back to the
// default. The name is said beside the avatar wherever one shows, so the avatar adds nothing to
// the text: a screen reader skips it, and the initial is drawn by CSS, so that "Eve: ..." doesn't
// read or copy as "EEve: ...".
const props = withDefaults(
  defineProps<{ name: string; avatar?: string | null; size?: 'small' | 'medium' | 'large' }>(),
  {
    avatar: null,
    size: 'small',
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
  <span class="avatar" :class="size" aria-hidden="true" :style="picture ? undefined : { background: colorOf(name) }">
    <img v-if="picture" :src="picture" alt="" @error="failed = true" />
    <span v-else class="initial num" :data-initial="initialOf(name)"></span>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 2px solid var(--ink);
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
</style>
