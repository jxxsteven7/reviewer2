import { BOARD_SIZE, CARD_COUNTS, otherTeam, TEAMS, type CardColor, type Team } from '@reviewer2/shared';
import { pick, shuffle, type Rng } from '../../core/random';
import type { Card } from './state';

// Lays out a board: the 25 words in random places, a random team to start, and the colors
// shuffled independently of the words. The starting team gets 9 cards and the other team 8;
// 7 cards are irrelevant papers and 1 is Reviewer 2.
export function deal(words: readonly string[], rng: Rng): { cards: Card[]; startingTeam: Team } {
  if (words.length !== BOARD_SIZE || new Set(words).size !== BOARD_SIZE) {
    throw new Error(`a board needs ${BOARD_SIZE} different words, not ${new Set(words).size}`);
  }
  const startingTeam = pick(TEAMS, rng);
  const colors: CardColor[] = [
    ...Array<CardColor>(CARD_COUNTS.starting).fill(startingTeam),
    ...Array<CardColor>(CARD_COUNTS.second).fill(otherTeam(startingTeam)),
    ...Array<CardColor>(CARD_COUNTS.neutral).fill('neutral'),
    ...Array<CardColor>(CARD_COUNTS.reviewer2).fill('reviewer2'),
  ];
  const places = shuffle(words, rng);
  const shuffled = shuffle(colors, rng);
  return {
    startingTeam,
    cards: places.map((word, index) => ({ word, color: shuffled[index] as CardColor, revealed: false })),
  };
}
