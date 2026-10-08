import {
  otherTeam,
  SPECTATOR,
  TEAMS,
  type Role,
  type Seat,
  type SeatError,
  type StartProblem,
  type Team,
} from '@reviewer2/shared';
import { pick, shuffle, type Rng } from '../../core/random';

// Who sits where, and the rules for changing seats (docs/games/keywords.md). Seats are keyed by
// player ID. keyViewers and sides are keyed by member key: a member key, unlike a player ID,
// stays the same when someone leaves the room and comes back, so nobody can return as a guesser
// who already knows the key, or as a player of the other group.

export interface Seating {
  seats: ReadonlyMap<string, Seat>;
  // Everyone who has been a captain in the current game, and so has seen the key.
  keyViewers: ReadonlySet<string>;
  // The group that each member has played for in the current game.
  sides: ReadonlyMap<string, Team>;
}

export interface Member {
  id: string;
  key: string;
}

// A seat as someone asks for it. A message names a team and a role apart, so the two may not go
// together; changeSeat() takes only the seats that exist.
export interface SeatRequest {
  readonly team: Team | null;
  readonly role: Role;
}

export type SeatChange = { ok: true; seating: Seating } | { ok: false; error: SeatError };

// How far the current game has got, as far as the seats care: there is none in the waiting room,
// one is on, or one is over but the chair hasn't played again yet. The seat rules of a game hold
// from its start until "play again", but only a seat taken while the game is on makes someone a
// player of it, or shows them a key that the end doesn't show everyone anyway.
export type GameStage = 'none' | 'on' | 'over';

export const emptySeating = (): Seating => ({ seats: new Map(), keyViewers: new Set(), sides: new Map() });

export const seatOf = (seating: Seating, id: string): Seat => seating.seats.get(id) ?? SPECTATOR;

export function captainOf(seating: Seating, team: Team): string | null {
  for (const [id, seat] of seating.seats) if (seat.role === 'captain' && seat.team === team) return id;
  return null;
}

// The seats that exist: a spectator's, and a captain's or a guesser's in one of the two teams.
// Anything else is refused, whatever the caller's types promise, and the seat that is kept is a
// new one, so that nothing the caller passed in stays in the room.
function seatLike(wanted: SeatRequest): Seat | null {
  if (typeof wanted !== 'object' || wanted === null) return null;
  const { team, role } = wanted;
  if (role === 'spectator') return team === null ? SPECTATOR : null;
  if (role !== 'captain' && role !== 'guesser') return null;
  return team !== null && TEAMS.includes(team) ? { team, role } : null;
}

// Seats a newcomer who has come to play as a guesser. Whoever has played for a group in the
// current game goes back to it. Anyone else goes to the group with fewer players in it, its
// captain and those who are offline included, or to either at random when both have as many. The
// rules of changeSeat() hold as for any other seat, so a newcomer who has seen the key in this
// game stays a spectator. Captains are never given out here: the chair's shuffle picks them.
export function autoSeat(seating: Seating, member: Member, rng: Rng, stage: GameStage): Seating {
  const team = seating.sides.get(member.key) ?? smallerTeam(seating, rng);
  const change = changeSeat(seating, member, { team, role: 'guesser' }, stage);
  return change.ok ? change.seating : seating;
}

function smallerTeam(seating: Seating, rng: Rng): Team {
  const size = (team: Team) => [...seating.seats.values()].filter((seat) => seat.team === team).length;
  const red = size('red');
  const blue = size('blue');
  if (red === blue) return pick(TEAMS, rng);
  return red < blue ? 'red' : 'blue';
}

// Moves a player to a seat. While a game is on, whoever sits down in a group belongs to it until
// the next game: they may step out to watch and come back, but not sit in the other group, where
// they could act in the other group's turn. A captain's seat taken over in the middle of a game
// shows that player the key, and nobody who has seen the key may become a guesser until the next
// game. Both rules hold once the game is over as well, until the chair plays again, because each
// group's chat is still there to read; but a seat taken then makes nobody a player of that game.
export function changeSeat(seating: Seating, member: Member, wanted: SeatRequest, stage: GameStage): SeatChange {
  const seat = seatLike(wanted);
  if (!seat) return { ok: false, error: 'bad_seat' };
  // Whoever asks for the seat they are in has it, and the seating is given back as it is, so that
  // the caller can tell that nothing has changed.
  const current = seatOf(seating, member.id);
  if (current.team === seat.team && current.role === seat.role) return { ok: true, seating };
  const bound = stage !== 'none';
  if (bound && seat.team !== null) {
    const side = seating.sides.get(member.key);
    if (side !== undefined && side !== seat.team) return { ok: false, error: 'other_team' };
  }
  if (seat.role === 'captain') {
    const holder = captainOf(seating, seat.team);
    if (holder !== null && holder !== member.id) return { ok: false, error: 'seat_taken' };
  }
  if (bound && seat.role === 'guesser' && seating.keyViewers.has(member.key)) {
    return { ok: false, error: 'key_viewer' };
  }
  const seats = new Map(seating.seats).set(member.id, seat);
  if (stage !== 'on' || seat.team === null) return { ok: true, seating: { ...seating, seats } };
  const sides = new Map(seating.sides).set(member.key, seat.team);
  const keyViewers = seat.role === 'captain' ? new Set(seating.keyViewers).add(member.key) : seating.keyViewers;
  return { ok: true, seating: { seats, keyViewers, sides } };
}

export function removeSeat(seating: Seating, id: string): Seating {
  const seats = new Map(seating.seats);
  seats.delete(id);
  return { ...seating, seats };
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

// A new game begins: the key viewers are now exactly the two captains, and everyone who sits in
// a group plays for it.
export function startGame(seating: Seating, keyOf: (id: string) => string): Seating {
  const keyViewers = new Set<string>();
  const sides = new Map<string, Team>();
  for (const [id, seat] of seating.seats) {
    if (seat.team === null) continue;
    sides.set(keyOf(id), seat.team);
    if (seat.role === 'captain') keyViewers.add(keyOf(id));
  }
  return { seats: seating.seats, keyViewers, sides };
}

// Back to the waiting room after a game: everyone keeps their seat, and nobody has seen the next
// key or played for a group yet.
export const endGame = (seating: Seating): Seating => ({
  seats: seating.seats,
  keyViewers: new Set(),
  sides: new Map(),
});

// The chair's "shuffle the groups", in the waiting room: everyone who sits in a group is dealt
// into the two groups at random, as evenly as possible, and the first player dealt to each group
// becomes its captain. Players who are online are dealt first. A game needs a captain and a
// guesser online in each group, so the shuffle doesn't hand those seats to someone who is away
// while enough others are there. Spectators keep their seats.
export function shuffleGroups(seating: Seating, rng: Rng, online: ReadonlySet<string>): Seating {
  const seated = [...seating.seats].filter(([, seat]) => seat.role !== 'spectator').map(([id]) => id);
  const present = seated.filter((id) => online.has(id));
  const away = seated.filter((id) => !online.has(id));
  const seats = new Map(seating.seats);
  let team: Team = TEAMS[rng.int(TEAMS.length)] as Team;
  const captains = new Set<Team>();
  for (const id of [...shuffle(present, rng), ...shuffle(away, rng)]) {
    seats.set(id, captains.has(team) ? { team, role: 'guesser' } : { team, role: 'captain' });
    captains.add(team);
    team = otherTeam(team);
  }
  return { ...seating, seats };
}
