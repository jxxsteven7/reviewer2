<script setup lang="ts">
import type { AccountSummary } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import PlayerAvatar from '../../components/PlayerAvatar.vue';
import PlayerNumber from '../../components/PlayerNumber.vue';
import UiButton from '../../components/UiButton.vue';
import UiField from '../../components/UiField.vue';
import ProfileAvatar from '../../views/ProfileAvatar.vue';
import ProfileEmail from '../../views/ProfileEmail.vue';
import SignIn from '../../views/SignIn.vue';
import { useSpot, type SpotTarget } from '../spot';
import ScenePart from './ScenePart.vue';

// A step of "Your account and page": the form to register, and the parts of the account page of an
// invented account, Mira's. Only to look at, and nothing in it is sent.
const props = defineProps<{ chapter: string; step: number }>();
const { t } = useI18n();

const summary = computed<AccountSummary>(() => ({
  id: 1024,
  handle: 'mira',
  username: t('guide.demo.me'),
  avatar: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  email: 'none',
  points: 0,
  titles: [],
  streaks: {},
  contributions: [],
  profile: { link: null, bio: t('guide.demo.bio'), showRecord: true, showThanks: true, banned: false },
  likes: 0,
  requests: 0,
  roomSetup: {},
  played: [],
}));
const link = ref('');
const bio = computed(() => summary.value.profile.bio ?? '');

const SPOTS: Record<number, SpotTarget> = {
  1: { selector: '.sign-in .actions .button', finger: 'point' },
  2: { selector: '.identity .avatar', finger: 'point' },
  3: { selector: '.checks', finger: 'point' },
  4: { selector: '.email', finger: 'point' },
};
const root = ref<HTMLElement | null>(null);
useSpot(root, () => SPOTS[props.step] ?? null);
</script>

<template>
  <div ref="root" class="account-scene" inert>
    <ScenePart v-if="step === 1">
      <SignIn register />
    </ScenePart>

    <ScenePart v-else-if="step === 2" class="identity">
      <div class="head">
        <PlayerAvatar :name="summary.username" :avatar="summary.avatar" size="large" />
        <div class="who">
          <p class="name-line">
            <span class="name">{{ summary.username }}</span>
            <UiButton variant="quiet" size="small" class="rename">{{ t('account.profile.rename') }}</UiButton>
          </p>
          <PlayerNumber :id="summary.id" />
          <ProfileAvatar :summary="summary" />
        </div>
      </div>
    </ScenePart>

    <ScenePart v-else-if="step === 3" :title="t('account.profile.public.title')">
      <p class="hint">{{ t('account.profile.public.intro') }}</p>
      <UiField
        v-model="link"
        :label="t('account.profile.public.link')"
        :hint="t('account.profile.public.linkHint')"
        :placeholder="t('account.profile.public.linkPlaceholder')"
      />
      <UiField :model-value="bio" :label="t('account.profile.public.bio')" />
      <div class="checks">
        <label class="check">
          <input type="checkbox" checked />
          <span>{{ t('account.profile.public.showRecord') }}</span>
        </label>
        <label class="check">
          <input type="checkbox" checked />
          <span>{{ t('account.profile.public.showThanks') }}</span>
        </label>
      </div>
    </ScenePart>

    <ScenePart v-else :title="t('account.profile.email')">
      <ProfileEmail :summary="summary" />
    </ScenePart>
  </div>
</template>

<style scoped>
.account-scene {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.who {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.name-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
}

.name {
  font-size: var(--text-xl);
  font-weight: var(--weight-black);
  line-height: 1.2;
}

.rename {
  min-height: 0;
  padding: 0 var(--space-1);
  color: var(--ink-2);
  font-size: var(--text-xs);
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.checks {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.check input {
  margin: 3px 0 0;
  accent-color: var(--ink);
}
</style>
