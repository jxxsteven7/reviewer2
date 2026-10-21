<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AvatarButton from '../../core/components/AvatarButton.vue';

// A seat's avatar in the hidden word game (docs/games/impostor.md#numbers): its number, in ink, on
// the color that the number chooses, as a guest's default avatar is drawn (PlayerAvatar.vue), so
// that a number has the same color wherever it shows. One that `opens` the seat's panel
// (SeatPanel.vue) wears the hard shadow of what can be pressed, as every avatar that opens something
// does; one in a row of the record, which opens nothing, has none. A seat that is out of the game is
// `faded`.
const props = withDefaults(
  defineProps<{
    number: number;
    size?: 'small' | 'medium' | 'large';
    faded?: boolean;
    opens?: (() => void) | null;
  }>(),
  { size: 'small', faded: false, opens: null },
);
const { t } = useI18n();
const name = computed(() => t('games.impostor.number', { number: props.number }));
</script>

<template>
  <AvatarButton
    :name="name"
    :initial="String(number)"
    :guest="number"
    :size="size"
    :faded="faded"
    :opens="opens"
    :label="t('games.impostor.openSeat', { number })"
  />
</template>
