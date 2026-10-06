import {
  otherTeam,
  SPECTATOR,
  TEAMS,
  type Seat,
  type SeatError,
  type StartProblem,
  type Team,
} from '@reviewer2/shared';
import { shuffle, type Rng } from '../../core/random';

// Who sits where, and the rules for changing seats (docs/games/keywords.md). Seats are keyed by
// player ID. keyViewers holds the member keys of everyone who has been a captain in the current
// game: a member key, unlike a player ID, stays the same when someone leaves the room and comes
// back, so a captain can't return as a guesser who already knows the key.

export interface Seating {
  seats: ReadonlyMap<string, Seat>;
  keyViewers: ReadonlySet<string>;
}

export interface Member {
  id: string;
  key: string;
}

export type SeatChange = { ok: true; seating: Seating } | { ok: false; error: SeatError };

export const emptySeating = (): Seating => ({ seats: new Map(), keyViewers: new Set() });

export const seatOf = (seating: Seating, id: string): Seat => seating.seats.get(id) ?? SPECTATOR;

export function captainOf(seating: Seating, team: Team): string | null {
  for (const [id, seat] of seating.seats) if (seat.role === 'captain' && seat.team === team) return id;
  return null;
}

const isValidSeat = (seat: Seat): boolean =>
  seat.role === 'spectator' ? seat.team === null : TEAMS.includes(seat.team as Team);

// Moves a player to a seat. `playing` is true while a game is on: then a captain's seat taken
// over in the middle of a game shows that player the key, and nobody who has seen the key may
// become a guesser until the next game.
export function changeSeat(seating: Seating, member: Member, seat: Seat, playing: boolean): SeatChange {
  if (!isValidSeat(seat)) return { ok: false, error: 'bad_seat' };
  if (seat.role === 'captain') {
    const holder = captainOf(seating, seat.team);
    if (holder !== null && holder !== member.id) return { ok: false, error: 'seat_taken' };
  }
  if (playing && seat.role === 'guesser' && seating.keyViewers.has(member.key)) {
    return { ok: false, error: 'key_viewer' };
  }
  const seats = new Map(seating.seats).set(member.id, seat);
  const keyViewers =
    playing && seat.role === 'captain' ? new Set(seating.keyViewers).add(member.key) : seating.keyViewers;
  return { ok: true, seating: { seats, keyViewers } };
}

export function removeSeat(seating: Seating, id: string): Seating {
  const seats = new Map(seating.seats);
  seats.delete(id);
  return { seats, keyViewers: seating.keyViewers };
}

// What still keeps a game from starting: each team needs exactly one captain, who is online, and
// at least one guesser who is online. The list is empty when the game can start.
export function startProblems(seating: Seating, online: ReadonlySet<string>): StartProblem[] {
  const problems: StartProblem[] = [];
  for (const team of TEAMS) {
    const captain = captainOf(seating, team);
    if (captain === null) problems.push({ problem: 'needs_captain', team });
    else if (!online.has(captain)) problems.push({ problem: 'captain_offline', team });
    const guessers = [...seating.seats].filter(
      ([id, seat]) => seat.team === team && seat.role === 'guesser' && online.has(id),
    );
    if (guessers.length === 0) problems.push({ problem: 'needs_guesser', team });
  }
  return problems;
}

// A new game begins: the key viewers are now exactly the two captains.
export function startGame(seating: Seating, keyOf: (id: string) => string): Seating {
  const keyViewers = new Set<string>();
  for (const team of TEAMS) {
    const captain = captainOf(seating, team);
    if (captain !== null) keyViewers.add(keyOf(captain));
  }
  return { seats: seating.seats, keyViewers };
}

// The chair's "shuffle the groups": everyone who sits in a group is dealt into the two groups at
// random, as evenly as possible, and the first player dealt to each group becomes its captain.
// Spectators keep their seats.
export function shuffleGroups(seating: Seating, rng: Rng): Seating {
  const playing = [...seating.seats].filter(([, seat]) => seat.role !== 'spectator').map(([id]) => id);
  const seats = new Map(seating.seats);
  let team: Team = TEAMS[rng.int(TEAMS.length)] as Team;
  const captains = new Set<Team>();
  for (const id of shuffle(playing, rng)) {
    seats.set(id, captains.has(team) ? { team, role: 'guesser' } : { team, role: 'captain' });
    captains.add(team);
    team = otherTeam(team);
  }
  return { seats, keyViewers: seating.keyViewers };
}
