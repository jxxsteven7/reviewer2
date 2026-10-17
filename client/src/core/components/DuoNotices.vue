<script setup lang="ts">
import type { DuoNotice } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { duoLineKey } from '../duos';
import type { ShownPlayer, ShownRoom } from '../room';
import AvatarButton from './AvatarButton.vue';
import TitleInfo from './TitleInfo.vue';

// The titles that the game which has just ended brought the viewer's friends who played in it
// (docs/architecture.md#friend-duos), under the decision letters, beside the streaks: a card for
// each, with the title, which a tap explains, the friend by name, the count that won it, and a
// line for the occasion. Only the viewer is told, so the screens have none. A screen reader is
// told of them by a live region that is on the page throughout the game, as for the streaks.
const props = defineProps<{ room: ShownRoom }>();
const { t } = useI18n();

// The friends who are still in the room, by name; a notice of someone the page doesn't know goes
// unshown.
const notices = computed(() =>
  props.room.duos.flatMap((notice) => {
    const player = props.room.players.find(({ id }) => id === notice.playerId);
    return player ? [{ notice, player }] : [];
  }),
);
const line = (notice: DuoNotice) => t(duoLineKey(props.room.gameId ?? '', notice.playerId, notice.title));
const headline = ({ notice, player }: { notice: DuoNotice; player: ShownPlayer }) =>
  t(`duos.notice.${notice.title}`, { name: player.name, count: notice.count });
const announcement = computed(() => notices.value.map((item) => `${headline(item)} ${line(item.notice)}`).join(' '));
</script>

<template>
  <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  <section v-if="notices.length > 0" class="duo-notices">
    <article v-for="{ notice, player } in notices" :key="`${notice.playerId}:${notice.title}`" class="notice">
      <p class="kicker">{{ t('duos.notice.kicker') }}</p>
      <h2 class="title"><TitleInfo :title="{ kind: 'duo', duo: notice.title }" /></h2>
      <i18n-t :keypath="`duos.notice.${notice.title}`" tag="p" class="headline" scope="global">
        <template #name>
          <span class="who">
            <AvatarButton
              :player-id="player.id"
              :name="player.name"
              :username="player.username"
              :avatar="player.avatar"
            />
            <strong>{{ player.name }}</strong>
          </span>
        </template>
        <template #count>{{ notice.count }}</template>
      </i18n-t>
      <p class="line">{{ line(notice) }}</p>
    </article>
  </section>
</template>

<style scoped>
.duo-notices {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-3) 0;
}

.notice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-2);
}

.kicker {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--bg);
  font-size: var(--text-xs);
}

.title {
  font-size: var(--text-2xl);
}

.headline {
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

.line {
  max-width: 34rem;
  color: var(--ink-2);
  line-height: 1.5;
}
</style>
