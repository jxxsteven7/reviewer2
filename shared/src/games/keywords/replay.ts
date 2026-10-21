import type { Language } from '../../language';
import type { ReplayPerson } from '../../replay';
import type { CardColor, ClueCount, ClueRecord, GameResult, Team } from './types';

// A finished game, to be replayed step by step (ReplayViewer on the client): the board as it was
// dealt, with every color, which the end of a game shows everyone anyway, the clues and the
// guesses as the record has them, the groups and who everyone in them was. The page builds one from
// the view when a game ends, for the review on the results page; the server works one out from the
// record of a game it kept, for the players with accounts (docs/architecture.md#replays), and shows
// it to them as ShownReplay.

export interface ReplayCard {
  word: string;
  color: CardColor;
}

// A group as the game ended: its PI and its students, by player ID, in the order of their seats.
export interface ReplayGroup {
  team: Team;
  captain: string | null;
  guessers: string[];
}

// The game: the board, the record, the result, and the groups as the game ended.
export interface KeywordsReplay {
  gameId: string;
  language: Language;
  startingTeam: Team;
  cards: ReplayCard[];
  history: ClueRecord[];
  result: GameResult;
  groups: ReplayGroup[];
}

// A replay as the viewer shows it: the game, and who everyone in it was, by player ID. `me` is the
// player ID that the viewer had in it, if any, whom the groups show first among the students, as
// they do in the game.
export interface ShownReplay extends KeywordsReplay {
  people: Record<string, ReplayPerson>;
  me: string | null;
}

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
      const { card, color, player } = guess;
      steps.push({ ...turn, guess: { card, color, player, right: color === record.team }, timedOut: false, revealed });
    }
    if (clue !== null && record.timedOut) steps.push({ ...turn, guess: null, timedOut: true, revealed });
  }
  return steps;
}

// What one player did in a game, for the list of their moves beside a replay: as a PI, each clue,
// or each turn whose time ran out before one, with the cards meant, how many of the group's own
// were found, how many were revealed and the card that ended the guesses, if it was a wrong one,
// and whether the time ran out; as a student, each card revealed and whether it was the group's
// own. Each comes with the step of the replay that shows it (replaySteps).
export type ReplayAction =
  | {
      kind: 'clue';
      step: number;
      turn: number;
      team: Team;
      word: string | null;
      count: ClueCount | null;
      targets: number[];
      found: number;
      guesses: number;
      stopped: { card: number; color: CardColor } | null;
      timedOut: boolean;
    }
  | { kind: 'guess'; step: number; turn: number; team: Team; card: number; color: CardColor; right: boolean };

export function actionsOf(replay: Pick<KeywordsReplay, 'history'>, playerId: string): ReplayAction[] {
  const actions: ReplayAction[] = [];
  // The step of the start, then one for each clue or missed clue, one for each guess, and one for
  // a time that ran out during the guesses, as replaySteps() counts them.
  let step = 0;
  for (const record of replay.history) {
    step += 1;
    const { turn, team } = record;
    if (record.captain === playerId) {
      const right = record.guesses.filter((guess) => guess.color === team).length;
      const last = record.guesses.at(-1);
      actions.push({
        kind: 'clue',
        step,
        turn,
        team,
        word: record.word,
        count: record.count,
        targets: record.targets ?? [],
        found: right,
        guesses: record.guesses.length,
        stopped: last && last.color !== team ? { card: last.card, color: last.color } : null,
        timedOut: record.timedOut === true,
      });
    }
    for (const guess of record.guesses) {
      step += 1;
      if (guess.player !== playerId) continue;
      const { card, color } = guess;
      actions.push({ kind: 'guess', step, turn, team, card, color, right: color === team });
    }
    if (record.word !== null && record.timedOut) step += 1;
  }
  return actions;
}
