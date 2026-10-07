<script setup lang="ts">
import type { RoomView } from '@reviewer2/shared';
import { computed, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerName from '../../core/components/PlayerName.vue';
import QrCode from '../../core/components/QrCode.vue';
import { useKeywords } from './useKeywords';

// The room on a big screen. In the waiting room, it shows how to join and who sits where. The
// board for the game itself comes in the next change.
const props = defineProps<{ room: RoomView }>();
const { t } = useI18n();
const { groups, spectators } = useKeywords(toRef(props, 'room'));
const link = computed(() => `${window.location.origin}/room/${props.room.code}`);
</script>

<template>
  <section class="screen">
    <div class="join">
      <QrCode :text="link" :label="t('room.qrHint', { code: `R2-${room.code}` })" />
      <p class="code mono">R2-{{ room.code }}</p>
      <p class="hint">{{ t('room.qrHint', { code: `R2-${room.code}` }) }}</p>
    </div>
    <div class="people">
      <p class="kicker">{{ t('home.games.keywords.name') }} &middot; {{ t('lobby.kicker') }}</p>
      <section v-for="group in groups" :key="group.team" class="group" :class="group.team">
        <h2>{{ t(`lobby.group.${group.team}`) }}</h2>
        <p class="role">{{ t('lobby.roles.captain') }}</p>
        <PlayerName v-if="group.captain" :player="group.captain" :me="false" :chair="false" :manageable="false" />
        <p v-else class="vacant">{{ t('lobby.vacant') }}</p>
        <p class="role">{{ t('lobby.roles.guesser') }}</p>
        <ul>
          <li v-for="player in group.guessers" :key="player.id">
            <PlayerName :player="player" :me="false" :chair="false" :manageable="false" />
          </li>
        </ul>
      </section>
      <p v-if="room.phase !== 'lobby'">{{ t('game.started') }}</p>
      <p v-else class="role">{{ t('lobby.roles.spectator') }} &middot; {{ spectators.length }}</p>
    </div>
  </section>
</template>

<style scoped>
.screen {
  display: grid;
  gap: var(--space-7);
  padding: var(--space-6) 0;
}

.join {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
}

.join :deep(.qr) {
  max-width: 20rem;
}

.code {
  font-size: var(--text-3xl);
  letter-spacing: 0.06em;
}

.hint {
  color: var(--ink-2);
}

.group {
  margin-top: var(--space-4);
  padding-left: var(--space-3);
  border-left: 3px solid var(--rule);
}

.group.red {
  border-left-color: var(--red);
}

.group.blue {
  border-left-color: var(--blue);
}

h2 {
  font-size: var(--text-xl);
}

.role {
  margin-top: var(--space-2);
  color: var(--ink-3);
  font-size: var(--text-sm);
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.vacant {
  color: var(--ink-3);
}

@media (min-width: 60rem) {
  .screen {
    grid-template-columns: auto 1fr;
    align-items: start;
  }
}

/* Chinese has no true italics, and slanted characters look broken. */
.vacant:lang(en) {
  font-style: italic;
}
</style>
