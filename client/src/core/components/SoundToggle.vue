<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { muted, setMuted } from '../sound';

// The switch for the sounds of the quick reactions, which this browser remembers (sound.ts).
const { t } = useI18n();
</script>

<template>
  <label class="sound-toggle">
    <input type="checkbox" :checked="muted" @change="setMuted(($event.target as HTMLInputElement).checked)" />
    <span>{{ t('emotes.mute') }}</span>
  </label>
</template>

<style scoped>
.sound-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  color: var(--ink-2);
  font-size: var(--text-sm);
  cursor: pointer;
}

input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--ink);
}
</style>
