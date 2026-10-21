<script setup lang="ts">
import type { GameCounts } from '@reviewer2/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { gameInfo } from '../../games/info';
import StatBlocks from './StatBlocks.vue';

// An account's record of a game as counts (docs/architecture.md#accounts), on the account's page
// and on its public page when its owner shows it: numbers on small blocks of their own
// (StatBlocks.vue), as the game counts them (GameInfo.recordStats): for the first game the games
// finished, the share won, in all and in each role, and the matches finished and won.
const props = defineProps<{ game: string; counts: GameCounts }>();
const { t, locale } = useI18n();
const info = computed(() => gameInfo(props.game));
const blocks = computed(() => info.value?.recordStats(t, props.counts, locale.value) ?? []);
</script>

<template>
  <StatBlocks
    class="record-stats"
    :blocks="blocks"
    :roles="info?.statsLayout === 'roles'"
    :thirds="info?.statsLayout === 'thirds'"
  />
</template>
