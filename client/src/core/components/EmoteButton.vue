<script setup lang="ts">
import { EMOTE_COOLDOWN_MS, EMOTES, type Emote } from '@reviewer2/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { readyAt, sendEmote } from '../emotes';
import { toastError } from '../toast';
import SoundToggle from './SoundToggle.vue';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The quick reactions: a button that opens the phrases (EMOTES, shared/src/protocol.ts) and the
// switch for their sounds. After one has gone, the button counts down the seconds until the next
// may. Every phrase is a row of its own, at least 44 pixels tall for a thumb, so that a dozen of
// them fit a phone's screen and none is hard to hit.
//
// While the game holds the viewer's reactions back (`held`, as for a PI while the students guess;
// docs/games/keywords.md#quick-reactions), the button stays where it is but looks and reads as
// disabled, and a tap on it says why; the phrases close if they were open.
const props = withDefaults(defineProps<{ held?: boolean }>(), { held: false });
const { t } = useI18n();
const open = ref(false);
watch(
  () => props.held,
  (held) => {
    if (held) open.value = false;
  },
);
function press() {
  if (props.held) toastError('emote_not_now');
  else open.value = true;
}
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
    <UiButton
      size="small"
      :class="{ held }"
      :aria-disabled="held ? 'true' : undefined"
      :disabled="secondsLeft > 0"
      @click="press"
    >
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

/* Held back: the look of a disabled button, which still takes a tap to say why. */
.emote-button :deep(.button.held) {
  border-color: var(--neutral);
  background: var(--paper-2);
  box-shadow: none;
  color: var(--ink-2);
  cursor: not-allowed;
}

.emote-button :deep(.button.held:active),
.emote-button :deep(.button.held:hover) {
  transform: none;
  box-shadow: none;
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
