<script setup lang="ts">
import type { ImpostorView } from '@reviewer2/shared/impostor';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import FoldCard from '../../core/components/FoldCard.vue';
import RoundBody from './RoundBody.vue';
import { outIn, roundsOf, type RoundRecord } from './seats';

// The hidden word game's record of the rounds (docs/rules/display.md#the-second-game), in the
// "Record" sheet: a fold for each round, which says on its right whom the round voted out and what
// they were, or that it is still on, and holds the round's lines, votes and reports (RoundBody.vue).
// The newest round that has been voted on is open to begin with.
const props = defineProps<{ game: ImpostorView }>();
const { t } = useI18n();

const rounds = computed(() => roundsOf(props.game));
const mine = computed(() => props.game.you?.number ?? null);
const open = ref<Record<number, boolean>>({});
watch(
  () => props.game.ballots.length,
  () => {
    const voted = [...rounds.value].reverse().find((record) => record.ballots.length > 0) ?? rounds.value[0];
    if (voted) open.value = { ...open.value, [voted.round]: true };
  },
  { immediate: true },
);

const roleOf = (number: number) => props.game.seats.find((seat) => seat.number === number)?.role ?? null;

function aside(record: RoundRecord): string {
  const out = outIn(record);
  if (out !== null) {
    const role = roleOf(out);
    return t('games.impostor.record.outAside', {
      number: out,
      role: role ? t(`games.impostor.roles.${role}`) : '',
    });
  }
  const current = record.round === props.game.round && props.game.phase !== 'over';
  if (current) return t(`games.impostor.record.now.${props.game.phase}`);
  return record.ballots.length > 0 ? t('games.impostor.record.nobodyOut') : '';
}
</script>

<template>
  <div class="round-log">
    <FoldCard
      v-for="record in rounds"
      :key="record.round"
      :open="open[record.round] ?? false"
      :title="t('games.impostor.record.round', { round: record.round })"
      :aside="aside(record)"
      @update:open="open = { ...open, [record.round]: $event }"
    >
      <RoundBody :record="record" :mine="mine" />
    </FoldCard>
  </div>
</template>

<style scoped>
.round-log {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
