<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { act } from '../socket';
import { useBusy } from '../useBusy';
import UiButton from './UiButton.vue';
import UiSheet from './UiSheet.vue';

// The chair's way to end a match before its last game, once they have confirmed it: in the
// match's table, and among the tools beside the board while a game is on, where the table is
// folded away. The confirmation says that nobody is awarded a title, where a match of the game
// would award titles (`titles`).
const props = withDefaults(defineProps<{ matchId: string; titles?: boolean }>(), { titles: true });
const { t } = useI18n();
const { busy, run } = useBusy();

const ending = ref(false);
async function end() {
  ending.value = false;
  await run(() => act('room:matchEnd', { matchId: props.matchId }));
}
</script>

<template>
  <div class="end-match">
    <UiButton variant="quiet" size="small" @click="ending = true">{{ t('match.end') }}</UiButton>
    <UiSheet :open="ending" :title="t('match.end')" @close="ending = false">
      <div class="confirm">
        <p>{{ t(titles ? 'match.endConfirm' : 'match.endConfirmUntitled') }}</p>
        <UiButton variant="danger" :disabled="busy" @click="end">{{ t('match.end') }}</UiButton>
        <UiButton variant="quiet" @click="ending = false">{{ t('lobby.manage.cancel') }}</UiButton>
      </div>
    </UiSheet>
  </div>
</template>

<style scoped>
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
