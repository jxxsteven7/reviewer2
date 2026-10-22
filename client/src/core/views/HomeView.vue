<script setup lang="ts">
import { isLanguage, REPOSITORY_URL } from '@reviewer2/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import tipCode from '../../assets/wechat-tip.jpg';
import AccountEntry from '../components/AccountEntry.vue';
import AcknowledgmentsList from '../components/AcknowledgmentsList.vue';
import BetaPill from '../components/BetaPill.vue';
import ContributionsList from '../components/ContributionsList.vue';
import LanguageSwitch from '../components/LanguageSwitch.vue';
import LinkArrow from '../components/LinkArrow.vue';
import PageMasthead from '../components/PageMasthead.vue';
import SendFeedback from '../components/SendFeedback.vue';
import SponsorsList from '../components/SponsorsList.vue';
import UiButton from '../components/UiButton.vue';
import UiSheet from '../components/UiSheet.vue';
import { games } from '../../games';
import { GAME_INFO } from '../../games/info';
import { account, loadAccount } from '../account';
import { GUIDE_PATH } from '../guide/progress';
import { siteAddress, usePageHead } from '../head';
import { setLanguage, storedLanguage, useLanguage } from '../i18n';
import { homeIn, LANGUAGE_QUERY } from '../site';
import { PRACTICE_ROLES } from '../practice';
import BackToRoom from './BackToRoom.vue';
import CreateRoom from './CreateRoom.vue';
import GuideEntry from './GuideEntry.vue';
import JoinRoom from './JoinRoom.vue';
import LanguageGate from './LanguageGate.vue';
import FriendsPlaying from './FriendsPlaying.vue';
import PracticeRoom from './PracticeRoom.vue';
import PublicRooms from './PublicRooms.vue';

// The home page: the way back to any room where the player still has a seat, the tagline, a line
// on how to play, the ways into a room, by its number, by the rooms that friends are in or from the
// list of public rooms, each game on a big sticker, with the way to play it with Reviewer 1, the
// games to come below them, the feedback contributions, the sponsors and the
// acknowledgments, folded, and footnotes, which offer a way to buy the author a cola and the way to send
// them feedback, each with a drawing, and name the build's version, which leads to the history up
// to it on GitHub. The author, linked to their page, follows the line on how to play, or on a
// narrow English page the tagline, whose last line has room for them there; the page holds both
// and shows one. On a wide screen the games stand on the right, beside the rest.
// The WeChat reward code is bundled with the page, as is everything it shows, and kept as the author
// gave it but for its metadata: WeChat reads it when a player presses and holds it, which a smaller
// or recompressed copy could spoil. Below it, a note tells tippers how to ask to be on the list of
// sponsors: by a name, or "list me", in the tip's message.
//
// A game's card names the game, with "Beta" beside a game in beta (BetaPill.vue), and its rules,
// as a new room in the page's language has them, and says how many play it. The cards come from
// the games (games/info.ts, games/index.ts), in their order.
//
// The first game's card leads into the tutorial (docs/architecture.md#the-tutorial): a guest, and an
// account that hasn't played the game, get the tutorial's green sticker above the button for a new
// room, and an account that has played it a small "Tutorial" beside the rules instead, once the
// page knows which it is. The account is asked for again whenever the page opens, so that a player
// back from their first game finds the small word at once. The tutorial's last steps lead here with
// the first game's room setup open (?create=1), or its practice sheet open with who plays and the
// role chosen (?practice=friends, or a role), which the address then drops, and the sheet takes
// once: it doesn't open again when the room setup, which stands in its place, is closed. One room
// setup is open at a time, in its game's card.
const { t } = useI18n();
const version = __APP_VERSION__;
const versionUrl = `${REPOSITORY_URL}/commits/${__APP_COMMIT__ ?? 'main'}`;
// The home page in a language, /?lang=zh as the sitemap lists it and the language gate links to it
// (site.ts), opens in that language, which becomes the visitor's choice, as on the gate; the
// address is then the home page's again.
const route = useRoute();
const router = useRouter();
const asked = route.query[LANGUAGE_QUERY];
const linked = typeof asked === 'string' && isLanguage(asked) ? asked : null;
if (linked) setLanguage(linked);
const askedRole = PRACTICE_ROLES.find((role) => role === route.query.practice);
const practice = ref(
  route.query.practice === 'friends'
    ? { who: 'friends' as const }
    : askedRole
      ? { who: 'me' as const, role: askedRole }
      : null,
);
const creating = ref<string | null>(route.query.create === '1' ? 'keywords' : null);
if (linked || 'practice' in route.query || 'create' in route.query) {
  const query = { ...route.query };
  for (const key of [LANGUAGE_QUERY, 'practice', 'create']) delete query[key];
  void router.replace({ query });
}
const chosen = ref(linked !== null || storedLanguage() !== null);
// The games with their screens, as the home page shows them.
const cards = GAME_INFO.flatMap((info) => {
  const screens = games[info.id];
  return screens ? [{ info, screens }] : [];
});
const language = useLanguage();
const tipping = ref(false);
const played = computed(() => (account.loaded ? (account.summary?.played.includes('keywords') ?? false) : null));
// The room setup that the tutorial opened comes into sight, below the masthead, once the router has
// scrolled the page to its top.
const firstGame = ref<HTMLElement | null>(null);
const keepFirst = (game: string) => (element: unknown) => {
  if (game === 'keywords') firstGame.value = element instanceof HTMLElement ? element : null;
};
onMounted(() => {
  if (account.loaded) void loadAccount();
  if (creating.value) requestAnimationFrame(() => firstGame.value?.scrollIntoView({ block: 'start' }));
});

const forthcoming = ['titles', 'abstracts'];

// The home page's title and description in its language, and its address in it; the language gate
// keeps the head that the page came with, which is in both languages unless the page was opened in
// one (site.ts).
usePageHead(() =>
  chosen.value
    ? {
        title: t('site.homeTitle', { site: t('app.name'), tagline: t('app.tagline') }),
        description: t('site.description'),
        canonical: siteAddress(homeIn(language.value)),
      }
    : { canonical: siteAddress('/') },
);
</script>

<template>
  <LanguageGate v-if="!chosen" @chosen="chosen = true" />
  <div v-else class="page home">
    <PageMasthead><AccountEntry /><LanguageSwitch /></PageMasthead>
    <BackToRoom />

    <main>
      <div class="heading">
        <h1>{{ t('app.tagline') }}</h1>
        <i18n-t keypath="footer.byline" tag="span" class="byline after-tagline" scope="global">
          <template #name>
            <a
              class="author text-link on-tint"
              href="https://jxxsteven7.github.io/"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t('footer.author') }}</a
            >
          </template>
        </i18n-t>
      </div>
      <p class="intro">
        <span>{{ t('home.intro') }}</span>
        <i18n-t keypath="footer.byline" tag="span" class="byline" scope="global">
          <template #name>
            <a
              class="author text-link on-tint"
              href="https://jxxsteven7.github.io/"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t('footer.author') }}</a
            >
          </template>
        </i18n-t>
      </p>

      <section class="ways">
        <JoinRoom />
        <FriendsPlaying />
        <PublicRooms />
      </section>

      <section class="contents">
        <ol>
          <li
            v-for="{ info, screens } in cards"
            :key="info.id"
            :ref="keepFirst(info.id)"
            class="entry"
            :data-game="info.id"
          >
            <div class="line">
              <span class="title"
                >{{ t(`games.${info.id}.name`) }}<BetaPill v-if="info.beta" :game="info.id" /><component
                  :is="screens.Rules"
                  link
                  defaults
                  :settings="screens.defaultSettings(language)"
                  :language="language"
                /><RouterLink v-if="screens.guide && played" class="guide-link" :to="GUIDE_PATH">{{
                  t('guide.entry.link')
                }}</RouterLink></span
              >
              <UiButton v-if="creating !== info.id" variant="primary" size="large" @click="creating = info.id">
                {{ t('home.newRoom') }}
              </UiButton>
            </div>
            <p class="summary">{{ t(`games.${info.id}.summary`) }}</p>
            <p class="meta">{{ t(`games.${info.id}.players`) }}</p>
            <GuideEntry v-if="screens.guide && creating !== info.id && played === false" />
            <PracticeRoom
              v-if="creating !== info.id"
              :game="info.id"
              :preset="info.id === 'keywords' ? practice : null"
              @taken="practice = null"
            />
            <CreateRoom v-if="creating === info.id" :game="info.id" @cancel="creating = null" />
          </li>
          <li v-for="game in forthcoming" :key="game" class="entry forthcoming">
            <div class="line">
              <span class="title">{{ t(`home.forthcomingGames.${game}.name`) }}</span>
              <span class="status">{{ t('home.forthcoming') }}</span>
            </div>
            <p class="summary">{{ t(`home.forthcomingGames.${game}.summary`) }}</p>
          </li>
        </ol>
      </section>

      <div class="thanks">
        <ContributionsList />
        <SponsorsList @tip="tipping = true" />
        <AcknowledgmentsList />
      </div>
    </main>

    <footer class="footnotes">
      <UiButton variant="quiet" size="small" @click="tipping = true">
        <span class="footnote">
          <svg class="icon cola" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 7.5 14 2h4" />
            <path class="cup" d="M6.5 9.5h11l-1.4 11.6a1.6 1.6 0 0 1-1.6 1.4H9.5a1.6 1.6 0 0 1-1.6-1.4Z" />
            <path class="band" d="M7.2 14.2h9.6l-.4 3.3H7.6Z" />
            <rect class="lid" x="5" y="6.6" width="14" height="3" rx="1.5" />
          </svg>
          {{ t('footer.tip') }}
        </span>
      </UiButton>
      <SendFeedback page="home">
        <span class="footnote">
          <svg class="icon bulb" viewBox="0 0 24 24" aria-hidden="true">
            <path
              class="glass"
              d="M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.8.6 1.4 1.5 1.4 2.5v.8h5v-.8c0-1 .6-1.9 1.4-2.5A6.5 6.5 0 0 0 12 2.5Z"
            />
            <path d="M9.5 20h5M10.5 22.5h3M9.4 8a3 3 0 0 1 2.1-2" />
          </svg>
          {{ t('footer.feedback') }}
        </span>
      </SendFeedback>
      <a
        class="version"
        :href="versionUrl"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="t('footer.versionLink', { version })"
        ><span class="line"
          ><span class="text num">{{ t('footer.version', { version }) }}</span
          ><LinkArrow /></span
      ></a>
    </footer>

    <UiSheet :open="tipping" :title="t('footer.tip')" @close="tipping = false">
      <figure class="tip">
        <img :src="tipCode" :alt="t('footer.tipCode')" width="1152" height="1152" />
        <figcaption>{{ t('footer.tipHint') }}</figcaption>
      </figure>
      <p class="listing">
        <strong>{{ t('footer.listTitle') }}</strong>
        {{ t('footer.listHow') }}
      </p>
      <p class="sponsor">
        <a class="text-link" href="https://github.com/sponsors/jxxsteven7" target="_blank" rel="noopener noreferrer">{{
          t('footer.sponsor')
        }}</a>
      </p>
    </UiSheet>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

main {
  display: grid;
  flex: 1;
  gap: var(--space-5);
  align-content: start;
  padding-top: var(--space-4);
}

h1 {
  font-size: var(--text-4xl);
  line-height: 1.08;
}

/* How to play, close under the tagline, and the author after it, who goes to the start of a line
   of their own when the sentence leaves no room. */
.intro {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-3);
  margin-top: calc(-1 * var(--space-4));
  font-size: var(--text-md);
}

.byline {
  color: var(--ink-2);
  white-space: nowrap;
}

/* Below 30rem the English tagline takes two lines (it fits on one from about 32rem), and the
   author follows its last line instead, going to a line of their own if it leaves no room. */
.after-tagline {
  display: none;
}

@media (max-width: 29.99rem) {
  .home:lang(en) h1 {
    display: inline;
    margin-inline-end: var(--space-3);
  }

  .home:lang(en) .after-tagline {
    display: inline-block;
  }

  .home:lang(en) .intro .byline {
    display: none;
  }
}

ol {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Each game is a big sticker that takes the row: its name and players on one row, the
   summary below, the button and the way to practice at the bottom, and the room setup in the
   place of the way to practice when it opens. The dashed stickers of the games to come follow,
   with room above them. */
.entry:not(.forthcoming) {
  display: grid;
  width: 100%;
  scroll-margin-top: calc(var(--masthead-height) + var(--space-3));
  margin-bottom: var(--space-3);
  grid-template-areas:
    'title meta'
    'summary summary'
    'guide guide'
    'button button'
    'create create';
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-3) var(--space-3);
  padding: var(--space-5) var(--space-4);
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-hero);
  background: var(--paper);
  box-shadow: var(--shadow-3);
}

.entry:not(.forthcoming) .line {
  display: contents;
}

.entry:not(.forthcoming) .line > :deep(.button) {
  grid-area: button;
  justify-self: stretch;
}

.entry:not(.forthcoming) > :deep(.create),
.entry:not(.forthcoming) > :deep(.practice) {
  grid-area: create;
}

.entry:not(.forthcoming) > :deep(.guide-entry) {
  grid-area: guide;
}

/* "Tutorial" follows "Rules" beside the game's name, as small and underlined, with a box that
   reaches 44 px high out of sight. */
.guide-link {
  position: relative;
  margin-left: var(--space-3);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  line-height: 1.2;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
  white-space: nowrap;
}

.guide-link::before {
  content: '';
  position: absolute;
  inset: calc(50% - 22px) -8px;
}

.title {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--weight-display);
  font-synthesis: none;
  line-height: 1.1;
}

.entry:not(.forthcoming) .title {
  grid-area: title;
}

.summary {
  grid-area: summary;
  line-height: 1.6;
}

.meta {
  grid-area: meta;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  white-space: nowrap;
}

/* The games to come: a dashed sticker each, with a line about the game. */
.forthcoming {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: var(--line) dashed var(--ink);
  border-radius: var(--radius-panel);
}

.forthcoming .line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
}

.forthcoming .title {
  font-family: var(--font-sans);
  font-size: var(--text-md);
  font-weight: var(--weight-black);
}

.forthcoming .summary {
  color: var(--ink-2);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.status {
  color: var(--ink-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

/* The ways into a room. Not named "join": a scoped rule reaches a child's root element, and the
   form of JoinRoom is one. */
.ways {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* The feedback contributions, the acknowledgments and the sponsors, a folded card each. */
.thanks {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Every footnote, button or link, is 44 px high with the same room on either side, so the words
   stand the same distance apart and on one line. The row reaches that room past both edges of the
   column, so the first footnote of every line starts on the column's edge. */
.footnotes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-2);
  margin: var(--space-6) calc(-1 * var(--space-2)) 0;
  padding: var(--space-3) 0 max(var(--space-4), env(safe-area-inset-bottom));
  font-size: var(--text-sm);
}

/* The build's version, a link off the site to the history up to it, grey as the issue numbers of
   the contributions are (docs/rules/display.md), with the arrow after it (LinkArrow.vue). Like the
   buttons beside it, its box centers a line laid out in the words' font, so that its digits, in
   the numbers' font, stand on the words' baseline on every system, where a line of their own font
   would stand higher or lower from one system to another. In Chinese it stands a pixel higher,
   where the digits' middle meets the characters'. Under a pointer it darkens, an underline sweeps
   in under the version and the arrow moves out; pressed, the underline is there at once and the
   arrow further out, and both ease back after. */
.version {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-2);
  color: var(--ink-2);
  font-weight: var(--weight-text);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--motion);
}

.version .text {
  line-height: 1;
  background: linear-gradient(currentcolor, currentcolor) 0 100% / 0 2px no-repeat;
  transition: background-size 220ms var(--ease-out);
}

.version .arrow {
  margin-inline-start: 3px;
}

.home:lang(zh) .version {
  position: relative;
  top: -1px;
}

@media (hover: hover) {
  .version:hover {
    color: var(--ink);
  }

  .version:hover .text {
    background-size: 100% 2px;
  }

  .version:hover .arrow {
    transform: translate(2px, -2px);
  }
}

.version:focus-visible .text {
  background-size: 100% 2px;
}

.version:active {
  color: var(--ink);
  transition-duration: 0s;
}

.version:active .text {
  background-size: 100% 2px;
  transition-duration: 0s;
}

.version:active .arrow {
  transform: translate(4px, -4px);
  transition-duration: 0s;
}

/* A small button's padding outweighs the quiet one's, and its border takes room too. */
.footnotes > :deep(.button) {
  padding: 0 var(--space-2);
  border-width: 0;
}

/* The footnotes' drawings, in ink, in front of their words: a cup of cola with a lid and a bent
   straw, and a light bulb for ideas. Each stands a pixel above the middle of its words' line, in
   either language, where it looks centered. */
.footnote {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
}

.icon {
  position: relative;
  top: -1px;
  display: block;
  flex: none;
  width: 1.5em;
  height: 1.5em;
  fill: none;
  stroke: var(--ink);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.bulb .glass {
  fill: var(--paper);
}

.cola .cup {
  fill: var(--red);
}

.cola .band {
  fill: var(--paper);
  stroke: none;
}

.cola .lid {
  fill: var(--paper);
}

/* The author's name is a text link on the table (base.css). Its focus ring sits close, clear of
   "By" before it. */
.author {
  display: inline-block;
}

.author:focus-visible {
  outline-offset: 0;
}

.tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
}

/* Shown whole, never cropped, at a size that a phone's camera and WeChat's press-and-hold read. */
.tip img {
  display: block;
  width: min(100%, 20rem);
  height: auto;
  border: var(--line-strong) solid var(--ink);
  border-radius: var(--radius-panel);
}

.tip figcaption,
.sponsor {
  color: var(--ink-2);
  font-size: var(--text-sm);
  text-align: center;
}

/* How a tipper gets on the list of sponsors: a sticker of its own, so that nobody misses it. */
.listing {
  width: min(100%, 20rem);
  margin: var(--space-4) auto 0;
  padding: var(--space-3) var(--space-4);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-control);
  background: var(--bg);
  box-shadow: var(--shadow-1);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.listing strong {
  display: block;
  margin-bottom: var(--space-1);
  font-size: var(--text-md);
}

.sponsor {
  margin-top: var(--space-3);
}

@media (min-width: 40rem) {
  .entry:not(.forthcoming) {
    padding: var(--space-6) var(--space-5);
  }
}

/* On a wide screen the contents stand on the right, and the rest keeps to the left, which is at
   least 30rem wide, so that the tagline stays on one line where the columns are at their
   narrowest. */
@media (min-width: 60rem) {
  main {
    grid-template-areas:
      'tagline contents'
      'intro contents'
      'ways contents'
      'thanks contents';
    grid-template-columns: minmax(30rem, 1.1fr) minmax(0, 1fr);
    grid-template-rows: auto auto auto 1fr;
    gap: var(--space-5) var(--space-7);
    padding-top: var(--space-6);
  }

  .heading {
    grid-area: tagline;
  }

  .intro {
    grid-area: intro;
    margin-top: calc(-1 * var(--space-3));
  }

  .contents {
    grid-area: contents;
  }

  .ways {
    grid-area: ways;
  }

  .thanks {
    grid-area: thanks;
    align-self: start;
  }
}
</style>
