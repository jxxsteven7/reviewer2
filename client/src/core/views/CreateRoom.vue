<script setup lang="ts">
import type { FieldInfo, Language } from '@reviewer2/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import FieldPicker from '../components/FieldPicker.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import UiButton from '../components/UiButton.vue';
import UiField from '../components/UiField.vue';
import { errorKey } from '../errors';
import { currentLanguage } from '../i18n';
import { storedName, storeName } from '../session';
import { connect, send, socket } from '../socket';

// Setting up a room: the language (the interface language, which the switch changes), the word
// lists, and the creator's nickname. The creator becomes the chair.
const props = defineProps<{ game: string; wordsNeeded: number }>();
const emit = defineEmits<{ cancel: [] }>();
const { t, locale } = useI18n();
const router = useRouter();

const fields = ref<FieldInfo[]>([]);
const chosen = ref<string[]>([]);
const name = ref(storedName());
const error = ref<string | undefined>();
const busy = ref(false);
const language = computed(() => locale.value as Language);
const usable = computed(() => fields.value.filter((field) => field.counts[language.value] >= props.wordsNeeded));

async function loadFields() {
  const reply = await send<{ fields: FieldInfo[] }>('meta:fields');
  if (!reply.ok) return;
  fields.value = reply.fields;
  pickDefault();
}

// Start with every usable list chosen; a room with one list is the usual case.
function pickDefault() {
  chosen.value = usable.value.map((field) => field.id);
}

watch(language, pickDefault);

onMounted(() => {
  if (socket.connected) void loadFields();
  else {
    socket.once('connect', () => void loadFields());
    connect();
  }
});

async function create() {
  error.value = undefined;
  busy.value = true;
  const reply = await send<{ code: string }>('room:create', {
    game: props.game,
    language: currentLanguage(),
    fields: chosen.value,
    name: name.value,
  });
  busy.value = false;
  if (!reply.ok) {
    error.value = t(errorKey(reply.error));
    return;
  }
  storeName(name.value.trim());
  await router.push(`/room/${reply.code}`);
}
</script>

<template>
  <form class="create" @submit.prevent="create">
    <section class="step">
      <h3>{{ t('create.language') }}</h3>
      <LanguageSwitch />
      <p class="hint">{{ t('create.languageHint', { language: t(`language.${language}`) }) }}</p>
    </section>

    <section class="step">
      <h3>{{ t('create.fields') }}</h3>
      <FieldPicker v-if="usable.length" v-model="chosen" :fields="fields" :language="language" :needed="wordsNeeded" />
      <p v-else class="hint">{{ t('create.noFields') }}</p>
    </section>

    <section class="step">
      <UiField
        v-model="name"
        :label="t('create.name')"
        :maxlength="32"
        autocomplete="nickname"
        enterkeyhint="go"
        :error="error"
      />
    </section>

    <div class="actions">
      <UiButton variant="primary" type="submit" :disabled="busy || !chosen.length || !name.trim()">
        {{ t('create.submit') }}
      </UiButton>
      <UiButton variant="quiet" @click="emit('cancel')">{{ t('create.cancel') }}</UiButton>
    </div>
  </form>
</template>

<style scoped>
.create {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-4) 0 var(--space-2);
}

.step {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

h3 {
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 500;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.06em;
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
</style>
