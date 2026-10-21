<script setup lang="ts">
import { checkReason, MAX_REASON_LENGTH, type ImpostorView } from '@reviewer2/shared/impostor';
import { textLength } from '@reviewer2/shared';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ChoiceRow from '../../core/components/ChoiceRow.vue';
import UiButton from '../../core/components/UiButton.vue';
import UiField from '../../core/components/UiField.vue';
import UiSheet from '../../core/components/UiSheet.vue';
import { errorKey } from '../../core/errors';
import { act, send } from '../../core/socket';
import { useBusy } from '../../core/useBusy';
import SeatAvatar from './SeatAvatar.vue';

// The panel that a seat's avatar opens in the hidden word game (docs/games/impostor.md#reports), one
// sheet over the game, which goes on meanwhile. Its title is the number alone, and the name after
// it only where the viewer may know who sits there; under the big avatar, every line the number
// wrote, by round. For a player still in the game, the way to report the seat for breaking the
// rules, while the game is on, no report is being judged and the player hasn't reported anyone this
// round; for the chair, the way to remove whoever sits there from the room, after a warning, which
// says that the game goes on without them, unless they are a Reviewer 2, and that it brings nobody
// points.
//
// The report is a sheet of its own over the panel, with the way back to it (UiSheet.vue): one of
// the seat's lines to point at, or none, and the reason, which may not give the reporter's own word
// away (checkReason), at most MAX_REASON_LENGTH characters. Sent, the report goes to the whole room
// and the clock stands still while it is judged (JudgeSheet.vue).
const props = defineProps<{
  game: ImpostorView;
  number: number | null;
  name?: string | null;
  isChair: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const { busy, run } = useBusy();
const group = useId();

const seat = computed(() => props.game.seats.find((other) => other.number === props.number) ?? null);
const mine = computed(() => props.game.you?.number ?? null);
// Every line the number wrote, with its place among the game's lines, which a report points at.
const lines = computed(() =>
  props.game.lines.flatMap((line, index) =>
    line.number === props.number && line.text !== null ? [{ ...line, text: line.text, index }] : [],
  ),
);
const playing = computed(
  () => props.game.phase !== 'over' && props.game.phase !== 'comeback' && props.game.result === null,
);
const meAlive = computed(
  () => mine.value !== null && props.game.seats.find((other) => other.number === mine.value)?.fate === 'alive',
);
const mayReport = computed(
  () =>
    playing.value &&
    meAlive.value &&
    seat.value?.fate === 'alive' &&
    props.number !== mine.value &&
    props.game.report === null &&
    !props.game.reported,
);
const mayRemove = computed(
  () => props.isChair && props.game.result === null && seat.value !== null && props.number !== mine.value,
);

const reporting = ref(false);
const removing = ref(false);
const line = ref<number | null>(null);
const reason = ref('');
const refused = ref<string | undefined>();
watch(
  () => props.number,
  () => {
    reporting.value = false;
    removing.value = false;
    line.value = null;
    reason.value = '';
    refused.value = undefined;
  },
);
// A report that can no longer be made, as when another one is being judged, closes its sheet.
watch(mayReport, (may) => {
  if (!may) reporting.value = false;
});

const word = computed(() => (props.game.you?.word ? { word: props.game.you.word } : null));
const checked = computed(() => checkReason(reason.value, word.value));
const reasonError = computed(() => {
  const { problem, match } = checked.value;
  if (!problem || problem === 'line_empty') return undefined;
  if (problem === 'line_has_word') return t('games.impostor.describe.hasWord', { match: match ?? '' });
  return t(errorKey(problem));
});
const count = computed(() => t('feedback.count', { count: textLength(checked.value.text), max: MAX_REASON_LENGTH }));

async function report() {
  if (props.number === null || checked.value.problem) return;
  refused.value = undefined;
  const reply = await run(() =>
    send('impostor:report', {
      gameId: props.game.gameId,
      round: props.game.round,
      number: props.number,
      line: line.value,
      reason: checked.value.text,
    }),
  );
  if (!reply) return;
  if (!reply.ok) {
    refused.value = t(errorKey(reply.error));
    return;
  }
  emit('close');
}

async function remove() {
  if (props.number === null) return;
  await run(() => act('room:remove', { seat: { gameId: props.game.gameId, number: props.number } }));
  emit('close');
}

const title = computed(() => (props.number === null ? '' : t('games.impostor.number', { number: props.number })));
</script>

<template>
  <UiSheet
    :open="number !== null && !reporting && !removing"
    :title="title"
    :subtitle="name ?? null"
    @close="emit('close')"
  >
    <div v-if="number !== null" class="seat-panel">
      <SeatAvatar class="big" :number="number" size="large" :faded="seat?.fate !== 'alive'" />
      <section class="said">
        <h3 class="label">{{ t('games.impostor.panel.lines') }}</h3>
        <ul v-if="lines.length" class="lines">
          <li v-for="said in lines" :key="said.index">
            <span class="text">{{ said.text }}</span>
            <span class="round num">{{ t('games.impostor.record.round', { round: said.round }) }}</span>
          </li>
        </ul>
        <p v-else class="hint">{{ t('games.impostor.panel.noLines') }}</p>
      </section>
      <div class="actions">
        <UiButton v-if="mayReport" @click="reporting = true">{{ t('games.impostor.panel.report') }}</UiButton>
        <UiButton v-if="mayRemove" variant="danger" @click="removing = true">{{ t('lobby.manage.remove') }}</UiButton>
      </div>
      <p v-if="mayRemove" class="hint">{{ t('games.impostor.panel.removeNote') }}</p>
      <p v-if="game.result === null && !name" class="hint">{{ t('games.impostor.panel.anonymousNote') }}</p>
    </div>
  </UiSheet>

  <UiSheet
    :open="number !== null && reporting"
    :title="t('games.impostor.report.title', { number: number ?? 0 })"
    :back="t('games.impostor.panel.back')"
    @back="reporting = false"
    @close="emit('close')"
  >
    <form class="report" @submit.prevent="report">
      <p class="hint">{{ t('games.impostor.report.intro') }}</p>
      <fieldset class="choices">
        <legend class="sr-only">{{ t('games.impostor.report.which') }}</legend>
        <ChoiceRow
          v-for="(said, place) in lines"
          :key="said.index"
          :option="`${place + 1}. ${said.text}`"
          :hint="t('games.impostor.record.round', { round: said.round })"
        >
          <input v-model="line" type="radio" :name="group" :value="said.index" />
        </ChoiceRow>
        <ChoiceRow :option="t('games.impostor.report.noLine')">
          <input v-model="line" type="radio" :name="group" :value="null" />
        </ChoiceRow>
      </fieldset>
      <UiField
        v-model="reason"
        :label="t('games.impostor.report.reason')"
        :hint="t('games.impostor.report.reasonHint', { count })"
        :error="reasonError"
        :maxlength="MAX_REASON_LENGTH * 4"
        multiline
        :rows="2"
      />
      <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
      <UiButton variant="danger" type="submit" :disabled="busy || checked.problem !== null">
        {{ t('games.impostor.report.submit', { number: number ?? 0 }) }}
      </UiButton>
      <UiButton variant="quiet" @click="reporting = false">{{ t('lobby.manage.cancel') }}</UiButton>
    </form>
  </UiSheet>

  <UiSheet :open="number !== null && removing" :title="t('lobby.manage.remove')" @close="removing = false">
    <div class="actions">
      <p>{{ t('games.impostor.panel.removeConfirm', { number: number ?? 0 }) }}</p>
      <UiButton variant="danger" :disabled="busy" @click="remove">{{ t('lobby.manage.remove') }}</UiButton>
      <UiButton variant="quiet" @click="removing = false">{{ t('lobby.manage.cancel') }}</UiButton>
    </div>
  </UiSheet>
</template>

<style scoped>
.seat-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.big {
  align-self: center;
}

.said {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.label {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
}

.lines {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.lines li {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  background: var(--paper-2);
  overflow-wrap: anywhere;
}

.text {
  flex: 1;
  min-width: 0;
  font-weight: var(--weight-bold);
}

.round {
  flex: none;
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.actions,
.report {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.report {
  gap: var(--space-3);
}

.choices {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>
