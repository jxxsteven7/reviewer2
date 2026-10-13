import {
  otherTeam,
  pointsFor,
  TEAMS,
  type KeywordsScoreDetail,
  type Lineup,
  type MatchRules,
  type StartProblem,
  type Team,
} from '@reviewer2/shared';
import type { MatchScore } from '../../core/game';
import { pick, type Rng } from '../../core/random';
import { smallerTeam, type Member, type Seating } from './seats';
import type { KeywordsState } from './state';

// The game's part of a match (docs/games/keywords.md#matches): how the groups are made from one
// game to the next, and how each player scores. The room keeps the totals.

export interface MatchSeating {
  rules: MatchRules;
  // In a match whose groups don't change, the group of everyone who has played a scored game in it,
  // by member key.
  locked: ReadonlyMap<string, Team>;
  // How many scored games each player has been a PI in, by member key, which decides whose turn it
  // is next with fixed groups.
  captained: ReadonlyMap<string, number>;
  // Those who came to play while a game was on, by member key. They play from the next game.
  waiting: ReadonlySet<string>;
}

export const newMatchSeating = (rules: MatchRules): MatchSeating => ({
  rules: { ...rules },
  locked: new Map(),
  captained: new Map(),
  waiting: new Set(),
});

// How the waiting room seats the players for the next game. Groups that don't change are free to
// choose, or drawn, for the first game only, and fixed once it has been scored.
export function lineupOf(match: MatchSeating | null): Lineup {
  if (!match) return 'free';
  if (match.rules.teams === 'fixed' && match.locked.size > 0) return 'fixed';
  return match.rules.grouping === 'random' ? 'draw' : 'free';
}

// A drawn game needs a PI and a student online in each group, which four players online make: the
// draw deals those who are online first.
export const DRAW_PLAYERS = 4;

// What keeps a drawn game from starting: too few players online in a seat.
export function drawProblems(seating: Seating, online: ReadonlySet<string>): StartProblem[] {
  let present = 0;
  for (const [id, seat] of seating.seats) if (seat.team !== null && online.has(id)) present += 1;
  return present >= DRAW_PLAYERS ? [] : [{ problem: 'needs_players', missing: DRAW_PLAYERS - present }];
}

// Whether a game counts for the match: every game does but one that the chair withdrew. A game in
// progress counts as it stands.
export const counts = (game: KeywordsState): boolean => game.result?.reason !== 'withdrawn';

// What a player revealed that wasn't their group's: irrelevant papers, the other group's cards
// and Reviewer 2.
interface Mistakes {
  irrelevant: number;
  wrong: number;
  reviewer2: number;
}
const noMistakes = (): Mistakes => ({ irrelevant: 0, wrong: 0, reviewer2: 0 });

// Each player's points in a game, as they stand (shared/src/games/keywords/score.ts): everyone who
// played for a group in it, by member key, with what their group found, whether it won, and what
// they revealed themselves of the irrelevant papers, the other group's cards and Reviewer 2. Null
// for a game that the chair withdrew. `keyOf` gives the member key of whoever revealed a card,
// also once they have left.
export function scoreGame(
  game: KeywordsState,
  sides: ReadonlyMap<string, Team>,
  keyOf: (playerId: string) => string,
): MatchScore[] | null {
  if (!counts(game)) return null;
  const found: Record<Team, number> = { red: 0, blue: 0 };
  const mistakes = new Map<string, Mistakes>();
  for (const record of game.history) {
    for (const guess of record.guesses) {
      if (guess.color === record.team) {
        found[record.team] += 1;
        continue;
      }
      const key = keyOf(guess.player);
      const tally = mistakes.get(key) ?? noMistakes();
      if (guess.color === 'reviewer2') tally.reviewer2 += 1;
      else if (guess.color === otherTeam(record.team)) tally.wrong += 1;
      else tally.irrelevant += 1;
      mistakes.set(key, tally);
    }
  }
  const winner = game.result?.winner ?? null;
  const keys = new Map<string, Team | null>(sides);
  for (const key of mistakes.keys()) if (!keys.has(key)) keys.set(key, null);
  return [...keys].map(([key, team]) => {
    const detail: KeywordsScoreDetail = {
      found: team ? found[team] : 0,
      won: team !== null && team === winner,
      ...(mistakes.get(key) ?? noMistakes()),
    };
    return { key, points: pointsFor(detail), detail };
  });
}

// What a scored game leaves to the rest of the match: everyone who was a PI in it has been one
// once more, and with groups that don't change, everyone who played for a group plays for it from
// now on. Those who played for it already keep it.
export function afterScoredGame(match: MatchSeating, seating: Seating): MatchSeating {
  const captained = new Map(match.captained);
  for (const key of seating.keyViewers) captained.set(key, (captained.get(key) ?? 0) + 1);
  if (match.rules.teams !== 'fixed') return { ...match, captained };
  const locked = new Map(match.locked);
  for (const [key, team] of seating.sides) if (!locked.has(key)) locked.set(key, team);
  return { ...match, captained, locked };
}

// Seats everyone who plays for the next game of a match whose groups are fixed: each in their own
// group, as a student, and those who haven't played yet in the group with fewer players. Then each
// group's PI is the one of them who has been a PI the fewest times, someone online before
// someone who isn't, and one of them at random when several have been as often. Spectators stay
// where they are.
export function arrangeFixed(
  seating: Seating,
  members: readonly Member[],
  match: MatchSeating,
  online: ReadonlySet<string>,
  rng: Rng,
): Seating {
  const playing = members.filter(({ id }) => (seating.seats.get(id)?.team ?? null) !== null);
  const seats = new Map(seating.seats);
  for (const { id } of playing) seats.delete(id);
  const known = playing.filter(({ key }) => match.locked.has(key));
  const newcomers = playing.filter(({ key }) => !match.locked.has(key));
  for (const { id, key } of known) seats.set(id, { team: match.locked.get(key) as Team, role: 'guesser' });
  for (const { id } of newcomers) {
    seats.set(id, { team: smallerTeam({ ...seating, seats }, rng), role: 'guesser' });
  }
  for (const team of TEAMS) {
    const group = playing.filter(({ id }) => seats.get(id)?.team === team);
    if (group.length === 0) continue;
    const there = group.filter(({ id }) => online.has(id));
    const pool = there.length > 0 ? there : group;
    const times = (key: string) => match.captained.get(key) ?? 0;
    const fewest = Math.min(...pool.map(({ key }) => times(key)));
    const { id } = pick(
      pool.filter(({ key }) => times(key) === fewest),
      rng,
    );
    seats.set(id, { team, role: 'captain' });
  }
  return { ...seating, seats };
}

function movedSet(set: ReadonlySet<string>, from: string, to: string): ReadonlySet<string> {
  if (!set.has(from)) return set;
  return new Set([...set].map((key) => (key === from ? to : key)));
}

// The group that a player plays for in the current game is the one of the seat they are in, under
// whichever key: a guest who logs in to an account that played earlier in the game plays on for the
// guest's group.
export function rekeySeating(seating: Seating, from: string, to: string): Seating {
  const side = seating.sides.get(from);
  const sides = new Map(seating.sides);
  if (side !== undefined) {
    sides.delete(from);
    sides.set(to, side);
  }
  return { seats: seating.seats, keyViewers: movedSet(seating.keyViewers, from, to), sides };
}

// What the match remembers of a guest, it remembers of their account from now on, added to what it
// knew of the account already: the games as a PI, and whether they play from the next game. With
// fixed groups, the account plays for `team`, the group of the seat that the guest has now, if any,
// or else for the guest's group, or else for its own: an account that played for the other group
// earlier in the match and left plays on for the group it sits in, since the seat stands.
export function rekeyMatch(match: MatchSeating, from: string, to: string, team: Team | undefined): MatchSeating {
  const locked = new Map(match.locked);
  const group = team ?? locked.get(from) ?? locked.get(to);
  const fixed = locked.has(from) || locked.has(to);
  locked.delete(from);
  if (fixed && group !== undefined) locked.set(to, group);
  const captained = new Map(match.captained);
  const times = (captained.get(from) ?? 0) + (captained.get(to) ?? 0);
  captained.delete(from);
  if (times > 0) captained.set(to, times);
  return { rules: match.rules, locked, captained, waiting: movedSet(match.waiting, from, to) };
}
