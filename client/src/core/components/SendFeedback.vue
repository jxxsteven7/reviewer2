<script lang="ts">
import {
  checkContact,
  checkCredit,
  checkFeedback,
  FEEDBACK_KINDS,
  MAX_CONTACT_INPUT,
  MAX_FEEDBACK_INPUT,
  MAX_FEEDBACK_LENGTH,
  MAX_NAME_INPUT,
  textLength,
  type FeedbackKind,
  type FeedbackMessage,
  type FeedbackPage,
} from '@reviewer2/shared';
import { computed, reactive, ref, toRefs, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { account } from '../account';
import { errorKey } from '../errors';
import { currentLanguage } from '../i18n';
import { connect, send } from '../socket';
import { toast } from '../toast';
import { useBusy } from '../useBusy';
import UiButton from './UiButton.vue';
import UiField from './UiField.vue';
import UiSheet from './UiSheet.vue';

// "Send feedback", for the footer of the home page and of a room, and its panel
// (docs/architecture.md); a page may give the button a label of its own, such as one with a
// drawing. The text, the contact and the name for the feedback contributions are checked by the
// rules that the server applies (shared/src/feedback.ts), and go as those rules clean them: what
// the player pasted may hold characters that JSON writes out at six bytes each, and the message has
// to stay under the server's 16 KB. The panel says that what is written may become a public GitHub
// issue, with the name if there is one and never the contact; without a name, the player is listed
// as anonymous. Along with them go the build of this page, the language it is shown in and whether
// it is the home page or a room, but never the room's code. With a bug, the server also keeps the
// browser's user agent, which it reads from the connection, and the panel says so. The server
// keeps the account the player is logged in to, whether they left a name or not, and a player
// logged in who leaves a name may let it open their public page from the feedback contributions,
// which the panel offers ticked until they untick it; a guest is asked
// to log in first, by a way to the account page that brings them back to their room, if they are
// in one, and may send it all the same. A new game, which the player suggests the project make next, gets a word on
// what to write.
//
// What is being written is kept outside the component, so that it survives the panel's closing
// and the component's going with it, as it does when the room menu that holds it closes.
const draft = reactive({
  kind: 'idea' as FeedbackKind,
  text: '',
  contact: '',
  credit: '',
  linkProfile: true,
});
</script>

<script setup lang="ts">
const props = defineProps<{ page: FeedbackPage }>();
const { t } = useI18n();
const name = useId();
const open = ref(false);
const route = useRoute();
const { kind, text, contact, credit, linkProfile } = toRefs(draft);
// Whether the server has said that this browser is a guest, who is asked to log in first.
const guest = computed(() => account.loaded && account.summary === null);
// From a room, the account page leads back to it once the player has logged in (AccountPage.vue);
// from anywhere else, it leads home.
const signIn = computed(() =>
  route.path.startsWith('/room/') ? { path: '/account', query: { next: route.path } } : '/account',
);
// What the server had against what was sent, until something is changed.
const refused = ref<string | undefined>();
const { busy, run } = useBusy();

const checked = computed(() => checkFeedback(text.value));
const checkedContact = computed(() => checkContact(contact.value));
const checkedCredit = computed(() => checkCredit(credit.value));
// Whether the name may open the player's public page: offered once anything is typed as the name,
// even a name that the rules refuse, by a player who is logged in.
const offersProfile = computed(
  () => account.summary !== null && (checkedCredit.value.credit !== null || checkedCredit.value.problem !== null),
);
watch([kind, text, contact, credit, linkProfile], () => (refused.value = undefined));

const count = computed(() => t('feedback.count', { count: textLength(checked.value.text), max: MAX_FEEDBACK_LENGTH }));
const textProblem = computed(() =>
  checked.value.problem === 'feedback_too_long' ? t(errorKey('feedback_too_long')) : undefined,
);
const contactProblem = computed(() =>
  checkedContact.value.problem ? t(errorKey(checkedContact.value.problem)) : undefined,
);
const creditProblem = computed(() =>
  checkedCredit.value.problem ? t(errorKey(checkedCredit.value.problem)) : undefined,
);
const ready = computed(
  () => checked.value.problem === null && checkedContact.value.problem === null && checkedCredit.value.problem === null,
);

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
      ...(checkedCredit.value.credit === null ? {} : { credit: checkedCredit.value.credit }),
      ...(offersProfile.value && checkedCredit.value.credit !== null ? { linkProfile: linkProfile.value } : {}),
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
    credit.value = '';
    linkProfile.value = true;
    open.value = false;
    toast('feedback.sent');
  });
}
</script>

<template>
  <UiButton variant="quiet" size="small" @click="openPanel">
    <slot>{{ t('feedback.open') }}</slot>
  </UiButton>

  <UiSheet :open="open" :title="t('feedback.title')" @close="open = false">
    <form class="feedback" @submit.prevent="submit">
      <div v-if="guest" class="guest">
        <p>{{ t('feedback.guest') }}</p>
        <RouterLink :to="signIn" class="sign-in">{{ t('feedback.signIn') }}</RouterLink>
      </div>
      <p class="note">{{ t('feedback.privacy') }}</p>

      <fieldset class="kinds">
        <legend>{{ t('feedback.kind') }}</legend>
        <label v-for="option in FEEDBACK_KINDS" :key="option" class="kind">
          <input v-model="kind" type="radio" :name="name" :value="option" />
          <span>{{ t(`feedback.kinds.${option}`) }}</span>
        </label>
      </fieldset>

      <p v-if="kind === 'game'" class="note">{{ t('feedback.gameNote') }}</p>
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
        enterkeyhint="next"
      />
      <UiField
        v-model="credit"
        :label="t('feedback.credit')"
        :hint="t('feedback.creditHint')"
        :maxlength="MAX_NAME_INPUT"
        :error="creditProblem"
        enterkeyhint="send"
      />
      <label v-if="offersProfile" class="profile">
        <input v-model="linkProfile" type="checkbox" />
        <span>{{ t('feedback.linkProfile') }}</span>
      </label>
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

.guest {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--bg-tint);
  font-size: var(--text-sm);
}

.guest p {
  flex: 1 1 12rem;
}

/* The way to the account page, a small sticker of its own like the account's entry on a page, as
   tall as a finger. */
.sign-in {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 44px;
  padding: var(--space-1) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  color: var(--ink);
  font-weight: var(--weight-bold);
  text-decoration: none;
}

/* The choice to let the name open the player's page: a row as tall as a finger, with a big box. */
.profile {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.profile input {
  flex: none;
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--ink);
}

.problem {
  color: var(--red-deep);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}
</style>
