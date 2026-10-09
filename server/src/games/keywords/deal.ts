import {
  BOARD_SIZE,
  CARD_COUNTS,
  otherTeam,
  TEAMS,
  wordKey,
  type BoardWord,
  type CardColor,
  type Team,
} from '@reviewer2/shared';
import { pick, shuffle, type Rng } from '../../core/random';
import type { Card } from './state';

// Lays out a board: the 25 words in random places, a random team to start, and the colors
// shuffled independently of the words. The starting team gets 9 cards and the other team 8;
// 7 cards are irrelevant papers and 1 is Reviewer 2. A word may come with its translations and
// its forms, which stay with its card.
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
  const shuffled = shuffle(colors, rng);
  return {
    startingTeam,
    cards: places.map(({ word, translations, forms }, index) => ({
      word,
      ...(translations?.length ? { translations: [...translations] } : {}),
      ...(forms?.length ? { forms: [...forms] } : {}),
      color: shuffled[index] as CardColor,
      revealed: false,
    })),
  };
}
