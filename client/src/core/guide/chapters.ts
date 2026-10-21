import type { Component } from 'vue';
import { games } from '../../games';
import type { PracticeRole } from '../practice';
import AccountScene from './scenes/AccountScene.vue';
import FeedbackScene from './scenes/FeedbackScene.vue';
import MoreScene from './scenes/MoreScene.vue';
import RoomsScene from './scenes/RoomsScene.vue';

// The chapters of the tutorial (docs/architecture.md#the-tutorial), in their order: each game's
// own, which the game lists (games/index.ts), and then the site's. A chapter's text is under
// guide.chapters.<id> in the locale files, a title and a line on what it is about, and a title and
// a body for each of its steps, numbered from 1. Its `scene` draws a step: the game's or the site's
// own parts, from invented data, with the finger on what the step is about (spot.ts). It takes the
// `step` and emits `next` when the reader has done what the step asks.
//
// What the last step offers: a real game with Reviewer 1 in the role the chapter taught (`play`),
// the next chapter (`next`), or the place on the site that the chapter is about (`try`).
export type TryPlace = 'account' | 'create' | 'friends' | 'feedback';
export type ChapterEnd = { play: PracticeRole } | { next: true } | { try: TryPlace };

export interface GuideChapter {
  id: string;
  // The game that the chapter is about, by its ID, or null for the site.
  game: string | null;
  steps: number;
  scene: Component;
  end: ChapterEnd;
}

// The site's chapter on the waiting room shows the first game's.
const firstGame = games.keywords?.guide;

const SITE_CHAPTERS: GuideChapter[] = [
  { id: 'account', game: null, steps: 4, scene: AccountScene, end: { try: 'account' } },
  { id: 'rooms', game: null, steps: 6, scene: RoomsScene, end: { try: 'create' } },
  ...(firstGame
    ? [{ id: 'lobby', game: null, steps: 4, scene: firstGame.Lobby, end: { try: 'friends' as const } }]
    : []),
  { id: 'more', game: null, steps: 4, scene: MoreScene, end: { try: 'account' } },
  { id: 'feedback', game: null, steps: 2, scene: FeedbackScene, end: { try: 'feedback' } },
];

export const chapters: GuideChapter[] = [
  ...Object.entries(games).flatMap(([game, screens]) =>
    (screens.guide?.chapters ?? []).map((chapter) => ({ ...chapter, game })),
  ),
  ...SITE_CHAPTERS,
];

export const chapterById = (id: string): GuideChapter | null => chapters.find((chapter) => chapter.id === id) ?? null;
