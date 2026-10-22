<script setup lang="ts">
import type { TitleCount } from '@reviewer2/shared';
import { useI18n } from 'vue-i18n';
import type { ShownRoom } from '../room';
import MatchTable from './MatchTable.vue';
import UiSheet from './UiSheet.vue';

// A match's table in a sheet while a game is on, "Match progress" (docs/rules/display.md), which
// the action bar opens on a phone and the tools on a wide screen: the table without its frame and
// its title, which the sheet has, and without the way to end the match, which stands among the
// tools; under it, what the game says of its scoring (the slot). The game says what else the table
// leaves out (MatchTable.vue): the titles each player brought in (`titlesOf`), the column of the
// game in progress (`delta`) and who is offline or gone (`presence`).
withDefaults(
  defineProps<{
    open: boolean;
    room: ShownRoom;
    titlesOf?: ((playerId: string) => TitleCount[]) | null;
    delta?: boolean;
    presence?: boolean;
  }>(),
  { titlesOf: null, delta: true, presence: true },
);
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
</script>

<template>
  <UiSheet :open="open" :title="t('match.progressTitle')" @close="emit('close')">
    <MatchTable
      v-if="room.match"
      :room="room"
      :endable="false"
      :titles-of="titlesOf"
      :delta="delta"
      :presence="presence"
      class="in-sheet"
    >
      <slot />
    </MatchTable>
  </UiSheet>
</template>

<style scoped>
/* Inside the sheet, the sheet's frame and title do: it says "Match progress" already. */
.in-sheet.in-sheet {
  padding: 0;
  border: 0;
  box-shadow: none;
}

.in-sheet :deep(.section-title) {
  display: none;
}
</style>
