import {
  bigClueCards,
  OPENING_RECORD,
  otherTeam,
  pointsFor,
  TEAMS,
  type ClueRecord,
  type KeywordsScoreDetail,
  type Lineup,
  type MatchRules,
  type Seat,
  type StartProblem,
  type Team,
} from '@reviewer2/shared';
import type { MatchScore } from '../../core/game';
import { pick, shuffle, type Rng } from '../../core/random';
import { dealGroups, smallerTeam, type Member, type Seating } from './seats';
import type { KeywordsState } from './state';

// The game's part of a match (docs/games/keywords.md#matches): how the groups are made from one
// game to the next, and how each player scores. The room keeps the totals.

export interface MatchSeating {
  rules: MatchRules;
  // In a match whose groups don't change, the group of everyone who has played a scored game in it,
  // by member key.
  locked: ReadonlyMap<string, Team>;
  // How many scored games each player has been a PI in, by member key, which decides whose turn it
  // is next.
  captained: ReadonlyMap<string, number>;
  // The groups of each scored game, oldest first: the group that each player played for in it, by
  // member key. Groups drawn at random keep apart those who have played together (drawGroups).
  groups: readonly ReadonlyMap<string, Team>[];
  // Those who came to play while a game was on, by member key. They play from the next game.
  waiting: ReadonlySet<string>;
}

export const newMatchSeating = (rules: MatchRules): MatchSeating => ({
  rules: { ...rules },
  locked: new Map(),
  captained: new Map(),
  groups: [],
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

// What a group's students revealed that wasn't the group's: irrelevant papers, the other group's
// cards and Reviewer 2, as the detail counts them.
type Mistakes = Pick<KeywordsScoreDetail, 'irrelevant' | 'wrong' | 'reviewer2'>;
const noMistakes = (): Mistakes => ({ irrelevant: 0, wrong: 0, reviewer2: 0 });

// Whether a turn is one whose captain gave no clue in time, with the captain whom it costs.
export const missedDeadline = (record: ClueRecord): boolean =>
  record.word === null && record.timedOut === true && record.captain !== undefined;

// A group's first clue of the game: its first turn with a clue, since a turn whose time ran out
// before the clue had none. Null before the group has given one.
export const firstClue = (game: KeywordsState, team: Team): ClueRecord | null =>
  game.history.find((record) => record.team === team && record.word !== null) ?? null;

// The own cards that the group's students found with a clue.
const foundWith = (record: ClueRecord): number => record.guesses.filter((guess) => guess.color === record.team).length;

// Whether a group's first clue made the opening record: its number was 3 or more, and the
// students found that many of the group's cards with it before they revealed anything else. A
// clue of 0 or "unlimited" names no number.
export function openingRecord(game: KeywordsState, team: Team): boolean {
  const first = firstClue(game, team);
  if (!first || typeof first.count !== 'number' || first.count < OPENING_RECORD) return false;
  const opening = first.guesses.slice(0, first.count);
  return opening.length === first.count && opening.every((guess) => guess.color === team);
}

// Whether a group won in the turn of its first clue, which is then the last turn of the game.
export function heavenlyHand(game: KeywordsState, team: Team): boolean {
  const { result } = game;
  return result?.winner === team && result.reason === 'found' && game.history.at(-1) === firstClue(game, team);
}

// Each player's points in a game, as they stand (shared/src/games/keywords/score.ts): everyone who
// played for a group in it, by member key, as its PI, having seen the key, or as a student, with
// what the group's students found and revealed wrongly, whether it won, its opening record and
// heavenly hand, and a PI's big clues and missed deadlines. A big clue goes to the PI who gave it,
// and a missed deadline to the PI whom the record blames (index.ts), by the member key that
// `keyOf` gives, also once they have left. Null for a game that the chair withdrew.
export function scoreGame(
  game: KeywordsState,
  seating: Pick<Seating, 'sides' | 'keyViewers'>,
  keyOf: (playerId: string) => string,
): MatchScore[] | null {
  if (!counts(game)) return null;
  const found: Record<Team, number> = { red: 0, blue: 0 };
  const mistakes: Record<Team, Mistakes> = { red: noMistakes(), blue: noMistakes() };
  const bigClues = new Map<string, number>();
  const missed = new Map<string, number>();
  for (const record of game.history) {
    if (missedDeadline(record)) {
      const key = keyOf(record.captain as string);
      missed.set(key, (missed.get(key) ?? 0) + 1);
    }
    for (const guess of record.guesses) {
      const tally = mistakes[record.team];
      if (guess.color === record.team) found[record.team] += 1;
      else if (guess.color === 'reviewer2') tally.reviewer2 += 1;
      else if (guess.color === otherTeam(record.team)) tally.wrong += 1;
      else tally.irrelevant += 1;
    }
    const cards = bigClueCards(foundWith(record));
    if (cards > 0 && record.captain !== undefined) {
      const key = keyOf(record.captain);
      bigClues.set(key, (bigClues.get(key) ?? 0) + cards);
    }
  }
  const winner = game.result?.winner ?? null;
  return [...seating.sides].map(([key, team]) => {
    const pi = seating.keyViewers.has(key);
    const detail: KeywordsScoreDetail = {
      role: pi ? 'captain' : 'guesser',
      found: found[team],
      won: team === winner,
      ...mistakes[team],
      bigClues: pi ? (bigClues.get(key) ?? 0) : 0,
      openingRecord: openingRecord(game, team),
      heavenlyHand: heavenlyHand(game, team),
      missed: pi ? (missed.get(key) ?? 0) : 0,
    };
    return { key, points: pointsFor(detail), detail };
  });
}

// What a scored game leaves to the rest of the match: everyone who was a PI in it has been one
// once more, its groups are the latest, and with groups that don't change, everyone who played for
// a group plays for it from now on. Those who played for it already keep it.
export function afterScoredGame(match: MatchSeating, seating: Seating): MatchSeating {
  const captained = new Map(match.captained);
  for (const key of seating.keyViewers) captained.set(key, (captained.get(key) ?? 0) + 1);
  const groups = [...match.groups, new Map(seating.sides)];
  if (match.rules.teams !== 'fixed') return { ...match, captained, groups };
  const locked = new Map(match.locked);
  for (const [key, team] of seating.sides) if (!locked.has(key)) locked.set(key, team);
  return { ...match, captained, groups, locked };
}

// Of these players, the one whose turn it is to be a PI: whoever has been one the fewest times in
// the match, someone online before someone who isn't, and one of them at random when several have
// been as often.
function nextPI(players: readonly Member[], match: MatchSeating, online: ReadonlySet<string>, rng: Rng): Member {
  const times = (key: string) => match.captained.get(key) ?? 0;
  const there = players.filter(({ id }) => online.has(id));
  const pool = there.length > 0 ? there : players;
  const fewest = Math.min(...pool.map(({ key }) => times(key)));
  return pick(
    pool.filter(({ key }) => times(key) === fewest),
    rng,
  );
}

// Makes each group's PI the one of its players whose turn it is (nextPI), and the others its
// students.
function seatPIs(
  seats: Map<string, Seat>,
  playing: readonly Member[],
  match: MatchSeating,
  online: ReadonlySet<string>,
  rng: Rng,
): void {
  for (const team of TEAMS) {
    const group = playing.filter(({ id }) => seats.get(id)?.team === team);
    if (group.length === 0) continue;
    for (const { id } of group) seats.set(id, { team, role: 'guesser' });
    seats.set(nextPI(group, match, online, rng).id, { team, role: 'captain' });
  }
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
  seatPIs(seats, playing, match, online, rng);
  return { ...seating, seats };
}

// How many deals drawGroups() chooses from.
export const DRAWS = 20;

// How often a deal puts together players who have played together in the match: each pair of
// players in one group counts once for every earlier game in which they were in one group too, and
// a later game counts more, as many times as its number, so that the game before counts most.
function together(deal: Seating, keyOf: (playerId: string) => string, groups: MatchSeating['groups']): number {
  const players = [...deal.seats].flatMap(([id, { team }]) => (team === null ? [] : [{ key: keyOf(id), team }]));
  let count = 0;
  groups.forEach((game, index) => {
    players.forEach((one, at) => {
      for (const other of players.slice(at + 1)) {
        const side = game.get(one.key);
        if (one.team === other.team && side !== undefined && side === game.get(other.key)) count += index + 1;
      }
    });
  });
  return count;
}

// Draws the groups for a match's game, as it starts, so that the PIs take turns and the groups
// mix. First the PIs: of everyone who plays, the one whose turn it is (nextPI), and then the one
// whose turn it is among the others, each the PI of one group, which a draw decides. They come
// before the groups because the two whose turn it is could otherwise be dealt into one group, where
// only one of them can be its PI. Then the groups: of DRAWS deals of the others around the PIs,
// each as the chair's shuffle deals (seats.ts), the one that puts together the fewest players who
// have played together in the match's earlier games (together), or one of them at random when
// several do as well. The draw needs its players online (drawProblems).
export function drawGroups(
  seating: Seating,
  members: readonly Member[],
  match: MatchSeating,
  online: ReadonlySet<string>,
  rng: Rng,
): Seating {
  const keys = new Map(members.map(({ id, key }) => [id, key]));
  const keyOf = (id: string) => keys.get(id) ?? id;
  const playing = members.filter(({ id }) => (seating.seats.get(id)?.team ?? null) !== null);
  // Everyone who plays goes back to a student's seat, so that the PIs alone hold a PI's seat.
  const seats = new Map(seating.seats);
  for (const [id, seat] of seating.seats) if (seat.team !== null) seats.set(id, { team: seat.team, role: 'guesser' });
  const pis: Member[] = [];
  for (const team of shuffle(TEAMS, rng)) {
    const rest = playing.filter((member) => !pis.includes(member));
    if (rest.length === 0) break;
    const pi = nextPI(rest, match, online, rng);
    pis.push(pi);
    seats.set(pi.id, { team, role: 'captain' });
  }
  const kept = new Set(pis.map(({ id }) => id));
  const deals = Array.from({ length: DRAWS }, () => dealGroups({ ...seating, seats }, rng, online, kept));
  const counted = deals.map((deal) => ({ deal, count: together(deal, keyOf, match.groups) }));
  const fewest = Math.min(...counted.map(({ count }) => count));
  return pick(
    counted.filter(({ count }) => count === fewest),
    rng,
  ).deal;
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
// knew of the account already: the games as a PI, the groups they played in, and whether they play
// from the next game. With fixed groups, the account plays for `team`, the group of the seat that
// the guest has now, if any, or else for the guest's group, or else for its own: an account that
// played for the other group earlier in the match and left plays on for the group it sits in, since
// the seat stands.
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
  const groups = match.groups.map((game) => {
    const side = game.get(from);
    if (side === undefined) return game;
    const moved = new Map(game);
    moved.delete(from);
    if (!moved.has(to)) moved.set(to, side);
    return moved;
  });
  return { rules: match.rules, locked, captained, groups, waiting: movedSet(match.waiting, from, to) };
}
