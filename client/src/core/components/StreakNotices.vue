<script setup lang="ts">
import type { StreakNotice } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLanguage } from '../i18n';
import type { ShownRoom } from '../room';
import { streakLineKey, streakTitle } from '../streaks';
import AvatarButton from './AvatarButton.vue';
import TitleInfo from './TitleInfo.vue';

// The streaks that the game which has just ended brought the players to
// (docs/architecture.md#streaks), under the decision letters. The viewer's own, won or lost, is a
// card: its title, which a tap explains, a line for the occasion, and whether it is a new record.
// Everyone else's winning streak is a cheer to the whole room, with a title that a tap explains
// as well, which the screens show too, as text, since nobody taps a screen; a losing streak is
// told to its player alone, so there is none to show for anyone else. `large` is for a big screen
// across a room.
//
// A screen reader is told of them by a live region that is on the page throughout the game, out of
// sight, since one that comes with its contents is often passed over; the notices themselves come
// and go with the end of the game.
const props = defineProps<{ room: ShownRoom; large?: boolean }>();
const { t } = useI18n();

const language = useLanguage();
const title = (notice: StreakNotice) => streakTitle(t, notice.kind, notice.length, language.value);
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
const cheerOf = ({ notice, player }: { notice: StreakNotice; player: { name: string } }) =>
  t('streaks.broadcast', { name: player.name, title: title(notice) });
const announcement = computed(() =>
  [
    ...(mine.value
      ? [
          t('streaks.announce', {
            kind: t(`streaks.kinds.${mine.value.kind}`),
            title: title(mine.value),
            line: line(mine.value),
          }),
          ...(mine.value.record ? [t('streaks.record')] : []),
        ]
      : []),
    ...cheers.value.map(cheerOf),
  ].join(' '),
);
</script>

<template>
  <p class="sr-only announcement" aria-live="polite">{{ announcement }}</p>
  <section v-if="mine || cheers.length > 0" class="streak-notices" :class="{ large }">
    <article v-if="mine" class="mine" :class="mine.kind">
      <p class="kicker">{{ t(`streaks.kinds.${mine.kind}`) }}</p>
      <h2 class="title">
        <TitleInfo :title="{ kind: 'streak', streak: mine.kind, length: mine.length, best: false }">{{
          title(mine)
        }}</TitleInfo>
      </h2>
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
        <span class="who">
          <AvatarButton
            :player-id="player.id"
            :name="player.name"
            :username="player.username"
            :guest="player.guest"
            :avatar="player.avatar"
            :size="large ? 'medium' : 'small'"
          />
          <strong>{{ player.name }}</strong>
        </span>
      </template>
      <template #title>
        <TitleInfo
          :title="{ kind: 'streak', streak: notice.kind, length: notice.length, best: false }"
          :still="large"
          class="word"
          >{{ title(notice) }}</TitleInfo
        >
      </template>
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

/* The cheer has no shadow: the strip itself can't be pressed, only the avatar and the title in it. */
.cheer {
  padding: var(--space-2) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--bg);
  font-weight: var(--weight-bold);
  overflow-wrap: anywhere;
}

/* The avatar and the name, on one line: the name sits on the baseline of the words around it, and
   the avatar is centered on the name. */
.who {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  vertical-align: baseline;
}

.who strong {
  align-self: baseline;
}

.large .mine {
  padding: var(--space-4) var(--space-5);
}

.large .cheer {
  padding: var(--space-3) var(--space-5);
  border-width: var(--line-strong);
  border-radius: var(--radius-panel);
  font-size: var(--text-xl);
}
</style>
