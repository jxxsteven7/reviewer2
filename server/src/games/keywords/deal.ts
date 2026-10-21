import { wordKey, type BoardWord } from '@reviewer2/shared';
import { BOARD_SIZE, CARD_COUNTS, otherTeam, TEAMS, type CardColor, type Team } from '@reviewer2/shared/keywords';
import { pick, shuffle, type Rng } from '../../core/random';
import type { Card } from './state';

// The board's side: it is 5 cards by 5, row by row.
const SIDE = 5;

// Whether a row or a column of the board is all one team's cards, which would make the board too
// easy. Diagonals don't count.
export function fullLine(colors: readonly CardColor[]): boolean {
  const lines = Array.from({ length: SIDE }, (_, line) => [
    Array.from({ length: SIDE }, (_, at) => colors[line * SIDE + at]),
    Array.from({ length: SIDE }, (_, at) => colors[at * SIDE + line]),
  ]).flat();
  return lines.some((cards) => TEAMS.some((team) => cards.every((color) => color === team)));
}

// Lays out a board: the 25 words in random places, a random team to start, and the colors
// shuffled independently of the words. The starting team gets 9 cards and the other team 8;
// 7 cards are irrelevant papers and 1 is Reviewer 2. A row or a column all of one team's cards is
// shuffled away: the colors are shuffled again, the words staying where they are, until none is,
// which about one board in 30 needs. A word may come with its translations, its forms, its pinyin
// and the English meanings of its characters, and as one of the chair's own, which stay with its
// card.
export function deal(words: readonly (string | BoardWord)[], rng: Rng): { cards: Card[]; startingTeam: Team } {
  const terms = words.map((word): BoardWord => (typeof word === 'string' ? { word } : word));
  // Two spellings of one word, such as "Coauthor" and "co-author", are one word: the clue check
  // couldn't tell their cards apart.
  const different = new Set(terms.map((term) => wordKey(term.word))).size;
  if (terms.length !== BOARD_SIZE || different !== BOARD_SIZE) {
    throw new Error(`a board needs ${BOARD_SIZE} different words: got ${terms.length}, ${different} of them different`);
  }
  const startingTeam = pick(TEAMS, rng);
  const colors: CardColor[] = [
    ...Array<CardColor>(CARD_COUNTS.starting).fill(startingTeam),
    ...Array<CardColor>(CARD_COUNTS.second).fill(otherTeam(startingTeam)),
    ...Array<CardColor>(CARD_COUNTS.neutral).fill('neutral'),
    ...Array<CardColor>(CARD_COUNTS.reviewer2).fill('reviewer2'),
  ];
  const places = shuffle(terms, rng);
  let shuffled = shuffle(colors, rng);
  while (fullLine(shuffled)) shuffled = shuffle(colors, rng);
  return {
    startingTeam,
    cards: places.map(({ word, translations, forms, pinyin, glosses, custom }, index) => ({
      word,
      ...(translations?.length ? { translations: [...translations] } : {}),
      ...(forms?.length ? { forms: [...forms] } : {}),
      ...(pinyin ? { pinyin } : {}),
      ...(glosses?.length ? { glosses: [...glosses] } : {}),
      ...(custom ? { custom } : {}),
      color: shuffled[index] as CardColor,
      revealed: false,
    })),
  };
}
