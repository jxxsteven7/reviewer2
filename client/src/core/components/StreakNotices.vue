<script setup lang="ts">
import { isLanguage, numberWords, type RoomView, type StreakNotice } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { streakLineKey } from '../streaks';
import PlayerAvatar from './PlayerAvatar.vue';

// The streaks that the game which has just ended brought the players to
// (docs/architecture.md#streaks), under the decision letters. The viewer's own, won or lost, is a
// card: its title, a line for the occasion, and whether it is a new record. Everyone else's winning
// streak is a cheer to the whole room, which the screens show too; a losing streak is told to its
// player alone, so there is none to show for anyone else. `large` is for a big screen across a room.
const props = defineProps<{ room: RoomView; large?: boolean }>();
const { t, locale } = useI18n();

const language = computed(() => (isLanguage(locale.value) ? locale.value : 'en'));
const title = (notice: StreakNotice) =>
  t(`streaks.names.${notice.kind}`, { n: numberWords(notice.length, language.value) });
const line = (notice: StreakNotice) =>
  t(streakLineKey(props.room.gameId ?? '', notice.playerId, notice.kind, notice.length));

const mine = computed(() => props.room.streaks.find((notice) => notice.playerId === props.room.me) ?? null);
// The winners who are still in the room, by name; a notice of someone the page doesn't know goes unshown.
const cheers = computed(() =>
  props.room.streaks
    .filter((notice) => notice.kind === 'wins' && notice.playerId !== props.room.me)
    .flatMap((notice) => {
      const player = props.room.players.find(({ id }) => id === notice.playerId);
      return player ? [{ notice, player }] : [];
    }),
);
</script>

<template>
  <section v-if="mine || cheers.length > 0" class="streak-notices" :class="{ large }" aria-live="polite">
    <article v-if="mine" class="mine" :class="mine.kind">
      <p class="kicker">{{ t(`streaks.kinds.${mine.kind}`) }}</p>
      <h2 class="title">{{ title(mine) }}</h2>
      <p class="line">{{ line(mine) }}</p>
      <p v-if="mine.record" class="record">{{ t('streaks.record') }}</p>
    </article>
    <i18n-t
      v-for="{ notice, player } in cheers"
      :key="player.id"
      keypath="streaks.broadcast"
      tag="p"
      class="cheer"
      scope="global"
    >
      <template #name>
        <PlayerAvatar :name="player.name" :avatar="player.avatar" />
        <strong>{{ player.name }}</strong>
      </template>
      <template #title>{{ title(notice) }}</template>
    </i18n-t>
  </section>
</template>

<style scoped>
.streak-notices {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  margin: var(--space-3) 0;
}

.mine {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.kicker {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--paper-2);
  font-size: var(--text-xs);
}

.wins .kicker {
  background: var(--blue-tint);
  color: var(--blue-deep);
}

.losses .kicker {
  background: var(--red-tint);
  color: var(--red-deep);
}

.title {
  font-size: var(--text-2xl);
}

.wins .title {
  color: var(--blue-deep);
}

.losses .title {
  color: var(--red-deep);
}

.line {
  max-width: 34rem;
  line-height: 1.5;
}

.record {
  padding: var(--space-1) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  font-weight: var(--weight-black);
}

.cheer {
  padding: var(--space-2) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--bg);
  box-shadow: var(--shadow-1);
  font-weight: var(--weight-bold);
  overflow-wrap: anywhere;
}

.cheer :deep(.avatar) {
  margin-right: var(--space-1);
  vertical-align: -0.45em;
}

.large .mine {
  padding: var(--space-4) var(--space-5);
}

.large .cheer {
  padding: var(--space-3) var(--space-5);
  border-width: var(--line-strong);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-2);
  font-size: var(--text-xl);
}
</style>
