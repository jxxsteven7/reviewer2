<script setup lang="ts">
import type { ImpostorView, ReportVerdict, ReportView } from '@reviewer2/shared/impostor';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ClockBar from '../../core/components/ClockBar.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { act } from '../../core/socket';
import { useBusy } from '../../core/useBusy';
import { reportLine, reportRows } from './rows';
import SeatAvatar from './SeatAvatar.vue';
import VoteRows from './VoteRows.vue';

// A report in the hidden word game (docs/games/impostor.md#reports), as the whole room sees it: a
// sheet that opens for everyone as it is made, with who reported whom, the line pointed at, if any,
// and the reason. Those who may judge it, everyone still in the game but the player reported, AI
// players too, agree or disagree, two white buttons alike, which lean neither way, while its clock
// runs; nobody sees how anyone else judged it, only how many have. Closing the sheet is judging it
// not at all, which counts as abstaining. Once everyone has judged it, or its time is up, the same
// sheet shows how it came out, every verdict revealed as the record shows votes (VoteRows.vue), until
// the viewer closes it; the game's clock runs again meanwhile.
const props = defineProps<{ game: ImpostorView }>();
const { t } = useI18n();
const { busy, run } = useBusy();

// The report being judged, and the newest that has been, as long as the viewer hasn't closed it.
const report = computed(() => props.game.report);
const closedOpen = ref<string | null>(null);
const shown = ref<ReportView | null>(null);
const keyOf = (one: ReportView) => `${props.game.gameId}-${one.round}-${one.by}`;
watch(
  () => props.game.reports.length,
  (count, before) => {
    const newest = props.game.reports.at(-1);
    if (newest && before !== undefined && count > before) shown.value = newest;
  },
  { immediate: true },
);
watch(
  () => props.game.gameId,
  () => (shown.value = null),
);

const openSheet = computed(() => report.value !== null && closedOpen.value !== keyOf(report.value));
const resultSheet = computed(() => !openSheet.value && shown.value !== null);
const current = computed(() => (openSheet.value ? report.value : shown.value));
const quoted = computed(() => {
  const line = current.value?.line;
  return line === null || line === undefined ? null : (props.game.lines[line] ?? null);
});

const judge = (verdict: ReportVerdict) => run(() => act('impostor:judge', { gameId: props.game.gameId, verdict }));
function close() {
  if (openSheet.value && report.value) closedOpen.value = keyOf(report.value);
  else shown.value = null;
}
const title = computed(() => {
  const one = current.value;
  if (!one) return '';
  if (openSheet.value) return t('games.impostor.report.made', { by: one.by, target: one.target });
  return t(one.passed ? 'games.impostor.report.passed' : 'games.impostor.report.failed');
});
</script>

<template>
  <UiSheet :open="openSheet || resultSheet" :title="title" @close="close">
    <div v-if="current" class="judge">
      <p v-if="resultSheet" class="hint">{{ reportLine(t, current) }}</p>
      <p v-if="resultSheet" class="outcome" :class="{ passed: current.passed }">
        {{
          current.passed
            ? t('games.impostor.report.outcomePassed', { number: current.target })
            : t('games.impostor.report.outcomeFailed', { number: current.by })
        }}
      </p>
      <div v-if="quoted" class="quote">
        <SeatAvatar :number="quoted.number" />
        <span class="text">
          <strong>{{ quoted.text }}</strong>
          <span class="hint">{{ t('games.impostor.report.saidIn', { round: quoted.round }) }}</span>
        </span>
      </div>
      <section class="reason">
        <h3 class="label">{{ t('games.impostor.report.reason') }}</h3>
        <p class="row">{{ current.reason }}</p>
      </section>
      <template v-if="openSheet">
        <template v-if="current.mayJudge">
          <h3 class="question">{{ t('games.impostor.report.question', { number: current.target }) }}</h3>
          <UiButton :disabled="busy" @click="judge('agree')">{{ t('games.impostor.report.agree') }}</UiButton>
          <UiButton :disabled="busy" @click="judge('disagree')">{{ t('games.impostor.report.disagree') }}</UiButton>
        </template>
        <p v-else-if="current.mine" class="mine">
          {{ t('games.impostor.report.yours', { verdict: t(`games.impostor.report.verdicts.${current.mine}`) }) }}
        </p>
        <ClockBar v-if="game.clock" :clock="game.clock" :period="`report-${keyOf(current)}`" :mine="current.mayJudge" />
        <p class="hint">
          {{ t('games.impostor.report.judged', { judged: current.judged, eligible: current.eligible }) }}
        </p>
        <p class="hint">{{ t('games.impostor.report.rules') }}</p>
      </template>
      <template v-else>
        <h3 class="label">{{ t('games.impostor.report.verdictsTitle') }}</h3>
        <VoteRows :rows="reportRows(t, current)" />
        <p class="hint">{{ t('games.impostor.report.goesOn') }}</p>
      </template>
    </div>
  </UiSheet>
</template>

<style scoped>
.judge {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.quote {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  overflow-wrap: anywhere;
}

.quote .text {
  display: flex;
  flex-direction: column;
}

.reason {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.label {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.row {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  overflow-wrap: anywhere;
}

.question {
  font-family: var(--font-sans);
  font-size: var(--text-md);
  font-weight: var(--weight-black);
}

.mine {
  font-weight: var(--weight-bold);
}

/* How the report came out, in the display font: what it cost, in red as points lost are. */
.outcome {
  color: var(--red-deep);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-display);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
