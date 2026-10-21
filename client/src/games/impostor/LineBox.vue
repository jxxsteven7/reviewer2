<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import UiButton from '../../core/components/UiButton.vue';
import UiField from '../../core/components/UiField.vue';

// Where a player of the hidden word game writes a move in words: their line in their turn, or their
// guess of the students' word (docs/games/impostor.md#describing). The field and its main button
// share a row, as JoinRoom.vue's does, the count of characters under them; what is wrong with the
// line, as the game checks it while the player types, takes the count's place in red, and keeps the
// button off, as an empty line does. Sent, the line goes, and the field is empty for the next one.
const props = withDefaults(
  defineProps<{
    label: string;
    action: string;
    count: string;
    error?: string | undefined;
    ready: boolean;
    busy?: boolean;
    maxlength?: number;
  }>(),
  { error: undefined, busy: false, maxlength: 1000 },
);
const text = defineModel<string>({ required: true });
const emit = defineEmits<{ send: [] }>();
const { t } = useI18n();
const disabled = computed(() => props.busy || !props.ready);
const send = () => {
  if (!disabled.value) emit('send');
};
</script>

<template>
  <form class="line-box" @submit.prevent="send">
    <UiField
      v-model="text"
      :label="label"
      :hint="count"
      :error="error"
      :maxlength="maxlength"
      enterkeyhint="send"
      :placeholder="t('games.impostor.describe.placeholder')"
    >
      <template #beside>
        <UiButton variant="primary" type="submit" :disabled="disabled">{{ action }}</UiButton>
      </template>
    </UiField>
  </form>
</template>

<style scoped>
.line-box {
  display: flex;
  flex-direction: column;
}
</style>
