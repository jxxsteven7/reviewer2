<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import { games } from '../../games';
import GuideFinger from '../components/GuideFinger.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import PageMasthead from '../components/PageMasthead.vue';
import PageTitle from '../components/PageTitle.vue';
import SendFeedback from '../components/SendFeedback.vue';
import UiButton from '../components/UiButton.vue';
import { chapterById, chapters, type GuideChapter, type TryPlace } from '../guide/chapters';
import { GUIDE_PATH, guidePath, keepProgress, readProgress } from '../guide/progress';
import { pageTitle, usePageHead } from '../head';
import { agents, checkAgents } from '../practice';
import { useMediaQuery } from '../useMediaQuery';

// The tutorial (docs/architecture.md#the-tutorial): its contents, and a chapter at one of its steps,
// each at an address of its own, /guide/<chapter>/<step>. The contents list the chapters in two
// groups, the game's and the site's, each with how far this browser has read it, and offer to go on
// with the chapter read last where it was left. A chapter has a bar at the top, with the way back to
// the contents, its number and title, the way out of the tutorial, and a row of the steps, read and
// to read; the coach card, which says what the step is about and leads back and on; and the scene,
// with the finger on what the step is about (GuideFinger.vue). On a phone the coach card stays at
// the bottom of the screen, over the scene, which has room below it to come up above the card; on a
// wider screen it stands in a column of its own beside the scene, over the list of the chapter's
// steps, each of which it leads to. The arrow keys go back and on, and Escape to the contents.
//
// The last step of a chapter leads on to a real game with Reviewer 1, in the role the chapter
// taught, on a server whose AI players can play, to the next chapter, or to the place on the site
// that the chapter is about: the account page, the home page with the room setup or the practice
// sheet open, or the feedback panel itself. A step beyond the chapter's steps is its nearest, and a
// chapter that doesn't exist is the contents.
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const wide = useMediaQuery('(min-width: 64rem)');
checkAgents();

const chapter = computed(() => {
  const id = route.params.chapter;
  return typeof id === 'string' ? chapterById(id) : null;
});
const asked = computed(() => Number.parseInt(String(route.params.step ?? '1'), 10));
const step = computed(() => {
  const steps = chapter.value?.steps ?? 1;
  return Number.isInteger(asked.value) ? Math.min(Math.max(asked.value, 1), steps) : 1;
});
const total = computed(() => chapter.value?.steps ?? 0);
const last = computed(() => step.value === total.value);
const numberOf = (id: string) => chapters.findIndex((each) => each.id === id) + 1;
const titleOf = (id: string) => t(`guide.chapters.${id}.title`);
const stepKey = (part: 'title' | 'body', n = step.value) => `guide.chapters.${chapter.value?.id}.steps.${n}.${part}`;

// The address names the step it shows: one beyond the chapter's steps, or none, is corrected, and
// a chapter that doesn't exist leads to the contents. The step read is kept (progress.ts).
watch(
  [() => route.params.chapter, chapter, step],
  ([id, current, now]) => {
    if (id === undefined || id === '') return;
    if (!current) {
      void router.replace(GUIDE_PATH);
      return;
    }
    if (String(route.params.step ?? '') !== String(now)) {
      void router.replace(guidePath(current.id, now));
      return;
    }
    keepProgress(current.id, now, current.steps);
  },
  { immediate: true },
);

const go = (n: number) => chapter.value && router.push(guidePath(chapter.value.id, n));
const back = () => step.value > 1 && go(step.value - 1);
const next = () => step.value < total.value && go(step.value + 1);

// The contents: the game's chapters under the game's name, then the site's, each with how far this
// browser has read it, and the chapter read last, if it was left halfway.
const progress = ref(readProgress());
watch(chapter, (current) => current === null && (progress.value = readProgress()));
const sections = computed(() => [
  ...Object.keys(games).map((game) => ({
    key: game,
    title: t('guide.sections.game', { game: t(`home.games.${game}.name`) }),
    chapters: chapters.filter((each) => each.game === game),
  })),
  { key: 'site', title: t('guide.sections.site'), chapters: chapters.filter((each) => each.game === null) },
]);
const resume = computed(() => {
  const id = progress.value.last;
  const at = id === null ? undefined : progress.value.chapters[id];
  const found = id === null ? null : chapterById(id);
  return found && typeof at === 'number' ? { chapter: found, step: Math.min(at, found.steps) } : null;
});
const stateOf = (each: GuideChapter) => {
  const at = progress.value.chapters[each.id];
  if (at === 'done') return { kind: 'done', text: t('guide.state.done') };
  if (typeof at === 'number') return { kind: 'at', text: t('guide.state.at', { step: at }) };
  return { kind: 'new', text: t('guide.state.steps', { count: each.steps }) };
};

// What the last step leads on to. A chapter that ends in a real game leads on to the next chapter
// on a server without AI players, where the home page offers no practice room.
const nextChapter = computed(() => {
  const at = chapters.findIndex((each) => each.id === chapter.value?.id);
  return chapters[at + 1] ?? null;
});
const ending = computed(() => {
  const end = chapter.value?.end;
  if (!end) return null;
  if ('play' in end && agents.value !== 'none') return { kind: 'play' as const, role: end.play };
  if ('try' in end) return { kind: 'try' as const, place: end.try };
  return { kind: 'next' as const };
});
const PLACES: Record<Exclude<TryPlace, 'feedback'>, RouteLocationRaw> = {
  account: '/account',
  create: { path: '/', query: { create: '1' } },
  friends: { path: '/', query: { practice: 'friends' } },
};
function finish() {
  const end = ending.value;
  if (!end) return;
  if (end.kind === 'play') void router.push({ path: '/', query: { practice: end.role } });
  else if (end.kind === 'try' && end.place !== 'feedback') void router.push(PLACES[end.place]);
  else if (end.kind === 'next') void router.push(nextChapter.value ? guidePath(nextChapter.value.id) : GUIDE_PATH);
}
const finishText = computed(() => {
  const end = ending.value;
  if (end?.kind === 'play') return t('guide.end.play');
  if (end?.kind === 'try') return t('guide.end.tryIt');
  return nextChapter.value
    ? t('guide.end.nextChapter', { chapter: titleOf(nextChapter.value.id) })
    : t('guide.end.contents');
});

// The arrow keys go back and on, and Escape to the contents, unless the reader is typing, as a PI
// writes a clue, or a panel is open over the page.
function onKey(event: KeyboardEvent) {
  if (!chapter.value || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('[role="dialog"]')) return;
  if (event.key === 'ArrowLeft') back();
  else if (event.key === 'ArrowRight') next();
  else if (event.key === 'Escape') void router.push(GUIDE_PATH);
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

usePageHead(() => ({
  title: pageTitle(chapter.value ? `${titleOf(chapter.value.id)} \u00b7 ${t('guide.title')}` : t('guide.title')),
}));
</script>

<template>
  <div class="page guide-page" :class="{ reading: chapter }">
    <template v-if="!chapter">
      <PageMasthead back><LanguageSwitch /></PageMasthead>
      <main>
        <PageTitle>{{ t('guide.title') }}</PageTitle>
        <p class="intro">{{ t('guide.intro') }}</p>
        <RouterLink v-if="resume" class="resume press" :to="guidePath(resume.chapter.id, resume.step)">
          <span class="play-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5Z" /></svg>
          </span>
          <span class="text">
            <span class="main">{{ t('guide.resume') }}</span>
            <span class="sub">{{
              t('guide.resumeAt', {
                chapter: titleOf(resume.chapter.id),
                step: resume.step,
                total: resume.chapter.steps,
              })
            }}</span>
          </span>
        </RouterLink>
        <div class="toc">
          <section v-for="section in sections" :key="section.key" class="toc-section">
            <h2 class="section-title">{{ section.title }}</h2>
            <ol>
              <li v-for="each in section.chapters" :key="each.id">
                <RouterLink class="chapter press" :to="guidePath(each.id)">
                  <span class="number num" aria-hidden="true">{{ numberOf(each.id) }}</span>
                  <span class="text">
                    <span class="main">{{ titleOf(each.id) }}</span>
                    <span class="sub">{{ t(`guide.chapters.${each.id}.about`) }}</span>
                  </span>
                  <span class="state" :class="stateOf(each).kind"
                    ><svg v-if="stateOf(each).kind === 'done'" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m5 12.5 4.5 4.5L19 7.5" /></svg
                    >{{ stateOf(each).text }}</span
                  >
                </RouterLink>
              </li>
            </ol>
          </section>
        </div>
      </main>
    </template>

    <template v-else>
      <header class="guide-bar">
        <RouterLink class="to-contents" :to="GUIDE_PATH">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
          {{ t('guide.contents') }}
        </RouterLink>
        <h1 class="where">{{ t('guide.numbered', { number: numberOf(chapter.id), title: titleOf(chapter.id) }) }}</h1>
        <RouterLink class="exit press" to="/" :aria-label="t('guide.exit')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </RouterLink>
        <div class="progress" aria-hidden="true">
          <span v-for="n in total" :key="n" :class="{ on: n <= step }"></span>
        </div>
      </header>

      <div class="reader">
        <aside class="coach-column">
          <section class="guide-coach" aria-live="polite">
            <p class="kicker num">{{ t('guide.progress', { step, total }) }}</p>
            <h2 class="coach-title">{{ t(stepKey('title')) }}</h2>
            <p class="coach-body">{{ t(stepKey('body')) }}</p>
            <div class="nav">
              <UiButton :disabled="step === 1" @click="back">{{ t('guide.back') }}</UiButton>
              <UiButton v-if="!last" variant="primary" @click="next">{{ t('guide.next') }}</UiButton>
              <SendFeedback
                v-else-if="ending?.kind === 'try' && ending.place === 'feedback'"
                page="home"
                variant="primary"
                size="normal"
                >{{ finishText }}</SendFeedback
              >
              <UiButton v-else variant="primary" @click="finish">{{ finishText }}</UiButton>
            </div>
            <RouterLink v-if="last" class="to-contents-end text-link" :to="GUIDE_PATH">{{
              t('guide.end.contents')
            }}</RouterLink>
          </section>
          <nav v-if="wide" class="step-list" :aria-label="t('guide.stepList')">
            <ol>
              <li v-for="n in total" :key="n" :class="{ now: n === step, seen: n < step }">
                <RouterLink :to="guidePath(chapter.id, n)" :aria-current="n === step ? 'step' : undefined"
                  ><span class="num">{{ n }}</span> {{ t(stepKey('title', n)) }}</RouterLink
                >
              </li>
            </ol>
          </nav>
        </aside>

        <div class="stage">
          <GuideFinger />
          <component :is="chapter.scene" :key="chapter.id" :chapter="chapter.id" :step="step" @next="next" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.intro {
  margin-bottom: var(--space-4);
  color: var(--ink-2);
}

/* The way on with the chapter read last, and each chapter: a sticker with a round badge, two lines
   and, for a chapter, how far it has been read. */
.resume,
.chapter {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0 var(--space-3);
  min-height: 64px;
  padding: var(--space-2) var(--space-4) var(--space-2) var(--space-3);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  color: var(--ink);
  text-decoration: none;
}

.resume {
  grid-template-columns: auto 1fr;
  margin-bottom: var(--space-5);
  background: var(--ink);
  color: var(--on-ink);
}

.resume .sub {
  color: var(--on-ink);
}

.play-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: var(--line) solid var(--on-ink);
  border-radius: 50%;
}

.play-icon svg {
  width: 18px;
  height: 18px;
  fill: var(--on-ink);
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.main {
  font-size: var(--text-lg);
  font-weight: var(--weight-black);
  line-height: 1.25;
}

.sub {
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.35;
}

.toc {
  display: grid;
  gap: var(--space-5);
}

.toc-section ol {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.number {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: var(--line) solid var(--ink);
  border-radius: 50%;
  background: var(--bg);
  font-size: var(--text-lg);
  font-weight: var(--weight-black);
}

.state {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  white-space: nowrap;
}

.state.done {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--ink);
}

.state svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3;
}

.state.at {
  padding: 2px var(--space-2);
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--bg);
  color: var(--ink);
}

@media (min-width: 64rem) {
  .toc {
    grid-template-columns: 1fr 1fr;
    gap: var(--space-6);
  }
}

/* A chapter fills the screen at least, so that its coach card stands at the bottom of a phone's
   below a short scene too. */
.guide-page.reading {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

/* A chapter's bar stays at the top of the screen, on the table's yellow from edge to edge. */
.guide-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--masthead-height);
  padding-top: env(safe-area-inset-top);
  border-image: linear-gradient(var(--bg), var(--bg)) 0 fill / 0 / 0 100vmax;
}

.to-contents {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: var(--space-1);
  min-height: 44px;
  color: var(--ink);
  font-weight: var(--weight-black);
  text-decoration: none;
}

.to-contents svg,
.exit svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.6;
}

.where {
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-lg);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.exit {
  display: grid;
  justify-self: end;
  place-items: center;
  width: 44px;
  height: 44px;
  border: var(--line) solid var(--ink);
  border-radius: 50%;
  background: var(--paper);
  box-shadow: var(--shadow-1);
}

.progress {
  display: flex;
  grid-column: 1 / -1;
  gap: 3px;
  padding-bottom: var(--space-2);
}

.progress span {
  flex: 1;
  height: 6px;
  border: var(--line-thin) solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
}

.progress span.on {
  background: var(--ink);
}

.reader {
  display: flex;
  flex: 1;
  flex-direction: column-reverse;
  gap: var(--space-4);
  padding-top: var(--space-2);
}

/* On a phone the coach card stays at the bottom of the screen, over the scene. */
.coach-column {
  position: sticky;
  bottom: max(var(--space-3), env(safe-area-inset-bottom));
  z-index: 9;
}

.guide-coach {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-3);
}

.kicker {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.coach-title {
  font-size: var(--text-xl);
  line-height: 1.15;
}

.coach-body {
  font-size: var(--text-md);
  line-height: 1.5;
}

.nav {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-3);
  margin-top: var(--space-1);
}

.nav > :deep(.button) {
  min-width: 0;
  padding-inline: var(--space-4);
  text-align: center;
}

.to-contents-end {
  align-self: center;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

/* Room below the scene, so that what the finger is at can come up above the coach card, and the
   hand fits below what it is at. */
.stage {
  position: relative;
  min-width: 0;
  margin-bottom: auto;
  padding-bottom: 30vh;
}

.step-list ol {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--space-4) 0 0;
  padding: 0;
  list-style: none;
}

.step-list a {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-small);
  color: var(--ink-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  text-decoration: none;
}

.step-list .seen a {
  color: var(--ink);
}

.step-list .now a {
  background: var(--ink);
  color: var(--on-ink);
}

.step-list .num {
  min-width: 1.5em;
  text-align: end;
}

@media (min-width: 64rem) {
  .reader {
    display: grid;
    grid-template-columns: 19rem minmax(0, 1fr);
    gap: var(--space-6);
    align-items: start;
  }

  .coach-column {
    top: calc(var(--masthead-height) + var(--space-5));
    bottom: auto;
  }

  .stage {
    max-width: 42rem;
    padding-bottom: 120px;
  }
}
</style>
