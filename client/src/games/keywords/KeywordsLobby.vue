<script setup lang="ts">
import { BOARD_SIZE, type FieldInfo, type PlayerView, type RoomView } from '@reviewer2/shared';
import { computed, onMounted, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import FieldPicker from '../../core/components/FieldPicker.vue';
import PlayerMenu from '../../core/components/PlayerMenu.vue';
import PlayerName from '../../core/components/PlayerName.vue';
import ShareTools from '../../core/components/ShareTools.vue';
import UiButton from '../../core/components/UiButton.vue';
import { send } from '../../core/socket';
import { useKeywords } from './useKeywords';

// The waiting room: the two groups with their PI and students, the spectators and the screens,
// and the chair's desk with the word lists, the shuffle and the start button.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const room = toRef(props, 'room');
const { data, mySeat, isChair, groups, spectators, act, sit } = useKeywords(room);

const managing = ref<PlayerView | null>(null);
const fields = ref<FieldInfo[]>([]);
const chosenFields = ref<string[]>([...props.room.fields]);
const fieldsChanged = computed(() => [...chosenFields.value].sort().join() !== [...props.room.fields].sort().join());

watch(
  () => props.room.fields,
  (current) => (chosenFields.value = [...current]),
);

onMounted(async () => {
  const reply = await send<{ fields: FieldInfo[] }>('meta:fields');
  if (reply.ok) fields.value = reply.fields;
});

const problems = computed(() => data.value.startProblems);
const isMe = (player: PlayerView) => player.id === props.room.me;
const isChairOf = (player: PlayerView) => player.id === props.room.chairId;
const manageable = (player: PlayerView) => isChair.value && !isMe(player);
</script>

<template>
  <section class="lobby">
    <header class="lobby-head">
      <p class="kicker">{{ t('home.games.keywords.name') }} &middot; {{ t('lobby.kicker') }}</p>
      <ShareTools :code="room.code" />
    </header>

    <div class="sections">
      <div class="groups">
        <section v-for="group in groups" :key="group.team" class="group" :class="group.team">
          <h2 class="section-title">{{ t(`lobby.group.${group.team}`) }}</h2>
          <dl>
            <dt>{{ t('lobby.roles.captain') }}</dt>
            <dd class="seat-line">
              <PlayerName
                v-if="group.captain"
                :player="group.captain"
                :me="isMe(group.captain)"
                :chair="isChairOf(group.captain)"
                :manageable="manageable(group.captain)"
                @manage="managing = $event"
              />
              <span v-else class="vacant">{{ t('lobby.vacant') }}</span>
              <UiButton v-if="!group.captain" size="small" @click="sit(group.team, 'captain')">
                {{ t('lobby.takeCaptain') }}
              </UiButton>
            </dd>
            <dt>{{ t('lobby.roles.guesser') }}</dt>
            <dd>
              <ul v-if="group.guessers.length" class="names">
                <li v-for="player in group.guessers" :key="player.id">
                  <PlayerName
                    :player="player"
                    :me="isMe(player)"
                    :chair="isChairOf(player)"
                    :manageable="manageable(player)"
                    @manage="managing = $event"
                  />
                </li>
              </ul>
              <p v-else class="vacant">{{ t('lobby.nobody') }}</p>
              <UiButton
                v-if="!(mySeat?.team === group.team && mySeat.role === 'guesser')"
                size="small"
                @click="sit(group.team, 'guesser')"
              >
                {{ t('lobby.joinAsGuesser') }}
              </UiButton>
            </dd>
          </dl>
        </section>
      </div>

      <section class="spectators">
        <h2 class="section-title">{{ t('lobby.roles.spectator') }}</h2>
        <ul v-if="spectators.length" class="names inline">
          <li v-for="player in spectators" :key="player.id">
            <PlayerName
              :player="player"
              :me="isMe(player)"
              :chair="isChairOf(player)"
              :manageable="manageable(player)"
              @manage="managing = $event"
            />
          </li>
        </ul>
        <p v-else class="vacant">{{ t('lobby.nobody') }}</p>
        <UiButton v-if="mySeat?.role !== 'spectator'" size="small" @click="sit(null, 'spectator')">
          {{ t('lobby.watch') }}
        </UiButton>
        <p v-if="room.screens > 0" class="screens">
          {{ t('lobby.screens', { count: room.screens }) }}
          <UiButton v-if="isChair" size="small" variant="quiet" @click="act('room:dismiss')">
            {{ t('lobby.dismissScreens') }}
          </UiButton>
        </p>
      </section>

      <p class="footnote">{{ t('lobby.captainNote') }}</p>

      <section v-if="isChair" class="desk">
        <h2 class="section-title">{{ t('lobby.desk') }}</h2>
        <h3 class="label">{{ t('lobby.fields') }}</h3>
        <FieldPicker v-model="chosenFields" :fields="fields" :language="room.language" :needed="BOARD_SIZE" />
        <UiButton
          v-if="fieldsChanged"
          size="small"
          :disabled="!chosenFields.length"
          @click="act('room:settings', { fields: chosenFields })"
        >
          {{ t('lobby.saveFields') }}
        </UiButton>
        <ul class="problems">
          <li v-for="item in problems" :key="`${item.problem}-${item.team}`">
            {{ t(`lobby.problems.${item.problem}`, { group: t(`lobby.group.${item.team}`) }) }}
          </li>
          <li v-if="!problems.length" class="ready">{{ t('lobby.ready') }}</li>
        </ul>
        <div class="desk-actions">
          <UiButton @click="act('room:shuffle')">{{ t('lobby.shuffle') }}</UiButton>
          <UiButton variant="primary" :disabled="problems.length > 0" @click="act('room:start', { round: room.round })">
            {{ t('lobby.start') }}
          </UiButton>
        </div>
      </section>
      <section v-else class="waiting">
        <ul class="problems">
          <li v-for="item in problems" :key="`${item.problem}-${item.team}`">
            {{ t(`lobby.problems.${item.problem}`, { group: t(`lobby.group.${item.team}`) }) }}
          </li>
        </ul>
        <p>{{ t('lobby.waiting') }}</p>
      </section>
    </div>

    <PlayerMenu :player="managing" @close="managing = null" />
  </section>
</template>

<style scoped>
.lobby-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5) 0 var(--space-4);
}

.groups {
  display: grid;
  gap: 0 var(--space-6);
}

.group,
.spectators,
.desk,
.waiting {
  padding: var(--space-4) 0;
  border-top: 1px solid var(--rule);
}

.group {
  padding-left: var(--space-3);
  border-left: 3px solid var(--rule);
}

.group.red {
  border-left-color: var(--red);
}

.group.blue {
  border-left-color: var(--blue);
}

dl {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: var(--space-3) var(--space-3);
  margin: var(--space-3) 0 0;
}

dt {
  padding-top: 6px;
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}

dd {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  min-width: 0;
}

.seat-line {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
}

.names {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.names.inline {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0 var(--space-4);
  margin: var(--space-3) 0 var(--space-2);
}

.vacant {
  color: var(--ink-3);
}

.spectators .vacant {
  margin: var(--space-3) 0 var(--space-2);
}

.screens {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-3);
  margin: var(--space-3) 0 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.footnote {
  padding: var(--space-3) 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.label {
  margin-top: var(--space-3);
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 500;
}

.problems {
  margin: var(--space-3) 0;
  padding: 0;
  list-style: none;
  color: var(--red);
  font-size: var(--text-sm);
}

.problems .ready {
  color: var(--ink-2);
}

.desk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.waiting p {
  color: var(--ink-2);
}

@media (min-width: 48rem) {
  .groups {
    grid-template-columns: 1fr 1fr;
  }
}

/* Chinese has no true italics, and slanted characters look broken. */
.vacant:lang(en) {
  font-style: italic;
}
</style>
