<script setup lang="ts">
import { rankFor, type DuoTitle, type Language, type TitleCount } from '@reviewer2/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import FoldedTitles from '../../components/FoldedTitles.vue';
import PlayerAvatar from '../../components/PlayerAvatar.vue';
import TitlePills from '../../components/TitlePills.vue';
import UiButton from '../../components/UiButton.vue';
import UiField from '../../components/UiField.vue';
import { wayUp } from '../../ranks';
import { streakTitles } from '../../streaks';
import { useSpot, type SpotTarget } from '../spot';
import ScenePart from './ScenePart.vue';

// A step of "Friends, ranks, titles, streaks": the parts of the account page of an invented account,
// Mira's, with friends, a rank, titles and a friend title of invented players. Only to look at.
const props = defineProps<{ chapter: string; step: number }>();
const { t, locale } = useI18n();

const POINTS = 260;
const rank = computed(() => t(`ranks.names.${rankFor(POINTS)}`));
const TITLES: TitleCount[] = [
  { game: 'keywords', title: 'heavenly_hand', count: 1 },
  { game: 'keywords', title: 'deadline_hero', count: 2 },
];
const streaks = computed(() => streakTitles(t, { wins: 3, losses: 0 }, locale.value as Language));
const DUO: DuoTitle[] = ['coauthor'];
const friends = computed(() => [
  { id: 'ava', name: t('guide.demo.friends.ava'), titles: DUO },
  { id: 'theo', name: t('guide.demo.friends.theo'), titles: [] },
]);
const query = ref('');

const SPOTS: Record<number, SpotTarget> = {
  1: { selector: '.search', finger: 'point' },
  2: { selector: '.rank-button', finger: 'point' },
  3: { selector: '.titles', finger: 'point' },
  4: { selector: '.folded-titles', finger: 'point' },
};
const root = ref<HTMLElement | null>(null);
useSpot(root, () => SPOTS[props.step] ?? null);
</script>

<template>
  <div ref="root" class="more-scene" inert>
    <ScenePart v-if="step === 1 || step === 4" :title="t('friends.title')">
      <div v-if="step === 1" class="search">
        <UiField v-model="query" :label="t('friends.search.label')" :placeholder="t('friends.search.placeholder')" />
        <UiButton>{{ t('friends.search.submit') }}</UiButton>
      </div>
      <ul class="friends">
        <li v-for="friend in friends" :key="friend.id" class="friend">
          <PlayerAvatar :name="friend.name" size="medium" />
          <span class="name">{{ friend.name }}</span>
          <FoldedTitles v-if="step === 4 && friend.titles.length" class="duo" :titles="friend.titles" />
        </li>
      </ul>
    </ScenePart>

    <ScenePart v-else-if="step === 2" :title="t('ranks.title')">
      <div class="rank-button">
        <span class="rank-line">
          <span class="rank">{{ rank }}</span>
          <span class="num">{{ t('ranks.points', { points: POINTS }) }}</span>
        </span>
        <span class="hint">{{ wayUp(t, POINTS) }}</span>
        <span class="open">{{ t('ranks.ladder.open') }}</span>
      </div>
      <p class="hint">{{ t('ranks.note') }}</p>
    </ScenePart>

    <ScenePart v-else :title="t('account.profile.titles')">
      <TitlePills :titles="TITLES" :streaks="streaks" />
    </ScenePart>
  </div>
</template>

<style scoped>
.more-scene {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.search {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
}

.search > :first-child {
  flex: 1;
  min-width: 0;
}

.friends {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.friend {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
}

.friend .name {
  font-weight: var(--weight-black);
}

.friend .duo {
  grid-column: 2;
}

/* The rank as the account page draws it, a sticker that opens the ladder there. */
.rank-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-card);
  background: var(--paper);
  box-shadow: var(--shadow-1);
}

.rank-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
}

.rank {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
}

.open {
  font-size: var(--text-sm);
  font-weight: var(--weight-black);
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
}

.hint {
  color: var(--ink-2);
  font-size: var(--text-sm);
}
</style>
