<script lang="ts">
import {
  checkContact,
  checkFeedback,
  FEEDBACK_KINDS,
  MAX_CONTACT_INPUT,
  MAX_FEEDBACK_INPUT,
  MAX_FEEDBACK_LENGTH,
  textLength,
  type FeedbackKind,
  type FeedbackMessage,
  type FeedbackPage,
} from '@reviewer2/shared';
import { computed, reactive, ref, toRefs, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { errorKey } from '../errors';
import { currentLanguage } from '../i18n';
import { connect, send } from '../socket';
import { toast } from '../toast';
import { useBusy } from '../useBusy';
import UiButton from './UiButton.vue';
import UiField from './UiField.vue';
import UiSheet from './UiSheet.vue';

// "Send feedback", for the footer of the home page and of a room, and its panel
// (docs/architecture.md). The text and the contact are checked by the rules that the server
// applies (shared/src/feedback.ts), and go as those rules clean them: what the player pasted may
// hold characters that JSON writes out at six bytes each, and the message has to stay under the
// server's 16 KB. Along with them go the build of this page, the language it is shown in and
// whether it is the home page or a room, but never the room's code. With a bug, the server also
// keeps the browser's user agent, which it reads from the connection, and the panel says so.
//
// What is being written is kept outside the component, so that it survives the panel's closing
// and the component's going with it, as it does when the room menu that holds it closes.
const draft = reactive({ kind: 'idea' as FeedbackKind, text: '', contact: '' });
</script>

<script setup lang="ts">
const props = defineProps<{ page: FeedbackPage }>();
const { t } = useI18n();
const name = useId();
const open = ref(false);
const { kind, text, contact } = toRefs(draft);
// What the server had against what was sent, until something is changed.
const refused = ref<string | undefined>();
const { busy, run } = useBusy();

const checked = computed(() => checkFeedback(text.value));
const checkedContact = computed(() => checkContact(contact.value));
watch([kind, text, contact], () => (refused.value = undefined));

const count = computed(() => t('feedback.count', { count: textLength(checked.value.text), max: MAX_FEEDBACK_LENGTH }));
const textProblem = computed(() =>
  checked.value.problem === 'feedback_too_long' ? t(errorKey('feedback_too_long')) : undefined,
);
const contactProblem = computed(() =>
  checkedContact.value.problem ? t(errorKey(checkedContact.value.problem)) : undefined,
);
const ready = computed(() => checked.value.problem === null && checkedContact.value.problem === null);

// The home page may have no connection yet. It is made when the panel opens, so that it is there
// by the time the player has written something.
function openPanel() {
  open.value = true;
  connect();
}

function submit() {
  void run(async () => {
    const message: FeedbackMessage = {
      kind: kind.value,
      text: checked.value.text,
      ...(checkedContact.value.contact === null ? {} : { contact: checkedContact.value.contact }),
      // The schema takes 64 characters; a build is named by its commit.
      version: __APP_VERSION__.slice(0, 64),
      language: currentLanguage(),
      page: props.page,
    };
    const reply = await send('meta:feedback', message);
    if (!reply.ok) {
      refused.value = t(errorKey(reply.error));
      return;
    }
    kind.value = 'idea';
    text.value = '';
    contact.value = '';
    open.value = false;
    toast('feedback.sent');
  });
}
</script>

<template>
  <UiButton variant="quiet" size="small" @click="openPanel">{{ t('feedback.open') }}</UiButton>

  <UiSheet :open="open" :title="t('feedback.title')" @close="open = false">
    <form class="feedback" @submit.prevent="submit">
      <p class="note">{{ t('feedback.privacy') }}</p>

      <fieldset class="kinds">
        <legend>{{ t('feedback.kind') }}</legend>
        <label v-for="option in FEEDBACK_KINDS" :key="option" class="kind">
          <input v-model="kind" type="radio" :name="name" :value="option" />
          <span>{{ t(`feedback.kinds.${option}`) }}</span>
        </label>
      </fieldset>

      <UiField
        v-model="text"
        multiline
        :rows="5"
        :label="t('feedback.text')"
        :maxlength="MAX_FEEDBACK_INPUT"
        :hint="count"
        :error="textProblem"
        autocapitalize="sentences"
        spellcheck
      />
      <UiField
        v-model="contact"
        :label="t('feedback.contact')"
        :hint="t('feedback.contactHint')"
        :maxlength="MAX_CONTACT_INPUT"
        :error="contactProblem"
        enterkeyhint="send"
      />
      <p v-if="kind === 'bug'" class="note">{{ t('feedback.bugNote') }}</p>

      <p v-if="refused" class="problem" role="alert">{{ refused }}</p>
      <UiButton variant="primary" type="submit" :disabled="busy || !ready">{{ t('feedback.submit') }}</UiButton>
    </form>
  </UiSheet>
</template>

<style scoped>
.feedback {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.note {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  width: 100%;
  margin-bottom: var(--space-2);
  padding: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.kind {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.kind:has(input:checked) {
  background: var(--bg);
}

.kind:has(input:focus-visible) {
  outline: var(--line-strong) solid var(--focus);
  outline-offset: 2px;
}

.kind input {
  margin: 0;
  accent-color: var(--ink);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>
