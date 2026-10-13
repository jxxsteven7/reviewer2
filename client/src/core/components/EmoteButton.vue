<script setup lang="ts">
import { EMOTE_COOLDOWN_MS, EMOTES, type Emote } from '@reviewer2/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { readyAt, sendEmote } from '../emotes';
import SoundToggle from './SoundToggle.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The quick reactions: a button that opens the phrases (EMOTES, shared/src/protocol.ts) and the
// switch for their sounds. After one has gone, the button counts down the seconds until the next
// may. Every phrase is a row of its own, at least 44 pixels tall for a thumb, so that a dozen of
// them fit a phone's screen and none is hard to hit.
const { t } = useI18n();
const open = ref(false);
const now = ref(Date.now());
const secondsLeft = computed(() => Math.max(0, Math.ceil((readyAt.value - now.value) / 1000)));

// The clock runs only while there is a wait to count down.
let timer: ReturnType<typeof setInterval> | undefined;
function stop() {
  clearInterval(timer);
  timer = undefined;
}
function tick() {
  now.value = Date.now();
  if (now.value >= readyAt.value) stop();
}
watch(
  readyAt,
  (at) => {
    now.value = Date.now();
    if (at > now.value && timer === undefined) timer = setInterval(tick, 250);
  },
  { immediate: true },
);
onBeforeUnmount(stop);

function send(emote: Emote) {
  open.value = false;
  void sendEmote(emote);
}
</script>

<template>
  <span class="emote-button">
    <UiButton size="small" :disabled="secondsLeft > 0" @click="open = true">
      {{ secondsLeft > 0 ? t('emotes.wait', { seconds: secondsLeft }) : t('emotes.open') }}
    </UiButton>
    <UiSheet :open="open" :title="t('emotes.title')" @close="open = false">
      <div class="emotes">
        <p class="hint">{{ t('emotes.hint', { seconds: EMOTE_COOLDOWN_MS / 1000 }) }}</p>
        <UiButton v-for="emote in EMOTES" :key="emote" class="phrase" @click="send(emote)">
          {{ t(`emotes.phrases.${emote}`) }}
        </UiButton>
        <SoundToggle />
      </div>
    </UiSheet>
  </span>
</template>

<style scoped>
.emote-button {
  flex: none;
}

.emotes {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.hint {
  margin-bottom: var(--space-1);
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.phrase {
  justify-content: flex-start;
  min-height: 44px;
  text-align: left;
}
</style>
