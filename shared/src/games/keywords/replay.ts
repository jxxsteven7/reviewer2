import type { Language } from '../../language';
import type { CardColor, ClueCount, ClueRecord, GameResult, Team } from './types';

// A finished game, to be replayed step by step (ReplayViewer on the client): the board as it was
// dealt, with every color, which the end of a game shows everyone anyway, the clues and the
// guesses as the record has them, and the names of those who revealed a card. The page builds one
// from the view when a game ends, for the review on the results page; the server keeps one for
// the players with accounts (docs/architecture.md#replays).

export interface ReplayCard {
  word: string;
  color: CardColor;
}

export interface KeywordsReplay {
  gameId: string;
  language: Language;
  startingTeam: Team;
  cards: ReplayCard[];
  history: ClueRecord[];
  result: GameResult;
  // The name that each player who revealed a card had in the game, by player ID. A guess by a
  // player who is missing here is shown without a name.
  players: Record<string, string>;
}

// The largest replay the server keeps, as JSON, in bytes.
export const MAX_REPLAY_BYTES = 64 * 1024;

// One step of a replay: how the game stood after one thing happened. The first step is the
// start, with nothing revealed; then each turn brings a step for its clue, or for the time that
// ran out before one, a step for each guess, and a step when the time ran out during the
// guesses.
export interface ReplayStep {
  // The turn the step is in, and whose it is; null at the start.
  turn: number | null;
  team: Team | null;
  // The turn's clue, or none yet.
  clue: { word: string; count: ClueCount } | null;
  // The guess the step shows, if it shows one: which card, who revealed it, and whether it was
  // one of the group's own.
  guess: { card: number; color: CardColor; player: string; right: boolean } | null;
  // Whether the step is the end of a phase whose time ran out.
  timedOut: boolean;
  // The cards revealed by the end of the step, in the order they were revealed.
  revealed: number[];
}

export function replaySteps(replay: Pick<KeywordsReplay, 'history'>): ReplayStep[] {
  const steps: ReplayStep[] = [{ turn: null, team: null, clue: null, guess: null, timedOut: false, revealed: [] }];
  let revealed: number[] = [];
  for (const record of replay.history) {
    const clue = record.word === null ? null : { word: record.word, count: record.count as ClueCount };
    const turn = { turn: record.turn, team: record.team, clue };
    steps.push({ ...turn, guess: null, timedOut: clue === null && record.timedOut === true, revealed });
    for (const guess of record.guesses) {
      revealed = [...revealed, guess.card];
      steps.push({ ...turn, guess: { ...guess, right: guess.color === record.team }, timedOut: false, revealed });
    }
    if (clue !== null && record.timedOut) steps.push({ ...turn, guess: null, timedOut: true, revealed });
  }
  return steps;
}
