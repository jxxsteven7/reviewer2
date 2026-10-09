import type { MatchRules, MatchStatus, MatchView, RoomPhase, StandingView, Title } from '@reviewer2/shared';
import type { MatchScore } from './game';
import { randomId } from './random';

// A match (docs/architecture.md#matches): the games it has scored, every player's total and the
// ranking at its end. The room holds it and tells it when a game starts and ends; the game module
// says how each player scored. Players are known by their member key, so that someone who drops
// out and comes back, or reloads the page, finds their total where they left it.

interface Entry {
  key: string;
  // The name and avatar that the player had when last seen in the room, for the table to show
  // after they have left it.
  name: string;
  avatar: string | null;
  total: number;
  // How many scored games the player took part in.
  games: number;
  // Their points in the last scored game they took part in.
  last: { gameId: string; points: number; detail: unknown } | null;
}

// Where a player finished: their place, shared with whoever has the same total, and their title.
export interface Placing {
  rank: number;
  total: number;
  title: Title | null;
}

// Who a member key is in the room now, or null for someone who has left it.
export type Present = (key: string) => { id: string; name: string; avatar: string | null } | null;

// Places by total, best first, with ties sharing a place and the next place skipping as many as
// shared it: 1, 1, 3.
export function rankings(players: readonly { key: string; total: number }[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const { key, total } of players) ranks.set(key, 1 + players.filter((other) => other.total > total).length);
  return ranks;
}

// The titles of a match that has run its course. Everyone with the highest total wins the Best
// Paper Award, and with three or more ranked players, everyone with the lowest is the game's black
// hole. When all have the same total, nobody is awarded anything.
export function titlesFor(players: readonly { key: string; total: number }[]): Map<string, Title> {
  const titles = new Map<string, Title>();
  if (players.length === 0) return titles;
  const totals = players.map(({ total }) => total);
  const best = Math.max(...totals);
  const worst = Math.min(...totals);
  if (best === worst) return titles;
  for (const { key, total } of players) {
    if (total === best) titles.set(key, 'best_paper');
    else if (total === worst && players.length >= 3) titles.set(key, 'black_hole');
  }
  return titles;
}

export class Match {
  // Names the match on the records and titles of accounts, and in the chair's messages about it.
  readonly id = randomId();
  readonly rules: MatchRules;
  #played = 0;
  #status: MatchStatus = 'on';
  // The last game that was scored, which no end can score twice.
  #lastGameId: string | null = null;
  // In the order in which the players entered the match.
  readonly #entries = new Map<string, Entry>();
  // The places at the end, which stay as they were then, whoever leaves afterwards.
  #final: Map<string, Placing> | null = null;

  constructor(rules: MatchRules) {
    this.rules = { ...rules };
  }

  // How many games have been scored.
  get played(): number {
    return this.#played;
  }

  get status(): MatchStatus {
    return this.#status;
  }

  // Lists a player who plays in a game that starts, with no points if they are new.
  enter(key: string, name: string, avatar: string | null): void {
    const entry = this.#entries.get(key);
    if (entry) Object.assign(entry, { name, avatar });
    else this.#entries.set(key, { key, name, avatar, total: 0, games: 0, last: null });
  }

  // Adds up a game that has ended. The match is over once it has scored as many games as its rules
  // say.
  score(gameId: string, scores: readonly MatchScore[], present: Present): void {
    if (this.#status !== 'on' || this.#lastGameId === gameId) return;
    for (const { key, points, detail } of scores) {
      const member = present(key);
      if (!this.#entries.has(key)) this.enter(key, member?.name ?? '', member?.avatar ?? null);
      const entry = this.#entries.get(key) as Entry;
      if (member) Object.assign(entry, { name: member.name, avatar: member.avatar });
      entry.total += points;
      entry.games += 1;
      entry.last = { gameId, points, detail };
    }
    this.#played += 1;
    this.#lastGameId = gameId;
    if (this.#played >= this.rules.games) this.finish('over', present);
  }

  // Ends the match: it is over, or the chair stopped it early. The players who took part in a
  // scored game and are still in the room are ranked; only a match that is over awards titles.
  finish(status: 'over' | 'stopped', present: Present): void {
    if (this.#status !== 'on') return;
    this.#status = status;
    const ranked = this.ranked(present);
    const ranks = rankings(ranked);
    const titles = status === 'over' ? titlesFor(ranked) : new Map<string, Title>();
    this.#final = new Map(
      ranked.map(({ key, total }) => [key, { rank: ranks.get(key) as number, total, title: titles.get(key) ?? null }]),
    );
  }

  // The players who count for the ranking now: those who took part in a scored game and are still
  // in the room.
  ranked(present: Present): { key: string; total: number }[] {
    return [...this.#entries.values()]
      .filter((entry) => entry.games > 0 && present(entry.key) !== null)
      .map(({ key, total }) => ({ key, total }));
  }

  // The places at the end, by member key, with how many players were ranked; null before the end.
  get final(): ReadonlyMap<string, Placing> | null {
    return this.#final;
  }

  // A guest's seat became an account's: the guest's line becomes the account's. They are the same
  // person, so when the account has a line of its own already, from before it left the room, the
  // two are added up.
  rekey(from: string, to: string): void {
    const entry = this.#entries.get(from);
    if (!entry) return;
    const own = this.#entries.get(to);
    if (own) {
      own.total += entry.total;
      own.games += entry.games;
      if (entry.last && (own.last === null || entry.last.gameId === this.#lastGameId)) own.last = entry.last;
      this.#entries.delete(from);
    } else {
      const entries = [...this.#entries].map(([key, value]): [string, Entry] =>
        key === from ? [to, { ...value, key: to }] : [key, value],
      );
      this.#entries.clear();
      for (const [key, value] of entries) this.#entries.set(key, value);
    }
    const placing = this.#final?.get(from);
    if (this.#final && placing && !this.#final.has(to)) {
      this.#final.delete(from);
      this.#final.set(to, placing);
    }
  }

  // The match as everyone sees it. `live` is each player's points in the game being played, as
  // they stand, which the room gives only while a game is being played.
  view(phase: RoomPhase, gameId: string | null, live: readonly MatchScore[] | null, present: Present): MatchView {
    const scoredNow = phase === 'ended' && gameId !== null && gameId === this.#lastGameId;
    const now = new Map((live ?? []).map((score) => [score.key, score]));
    const focus = phase === 'playing' || (phase === 'ended' && !scoredNow) ? null : this.#lastGameId;
    const ranks = this.#final ? null : rankings(this.ranked(present));
    const standings = [...this.#entries.values()].map((entry): StandingView => {
      const member = present(entry.key);
      const placing = this.#final?.get(entry.key);
      const current = now.get(entry.key);
      const last = focus !== null && entry.last?.gameId === focus ? entry.last : null;
      const avatar = member ? member.avatar : entry.avatar;
      return {
        playerId: member?.id ?? null,
        name: member?.name ?? entry.name,
        ...(avatar ? { avatar } : {}),
        total: entry.total,
        delta: current?.points ?? last?.points ?? null,
        ...(current || last ? { detail: structuredClone(current?.detail ?? last?.detail) } : {}),
        games: entry.games,
        rank: (this.#final ? placing?.rank : ranks?.get(entry.key)) ?? null,
        left: member === null,
        ...(placing?.title ? { title: placing.title } : {}),
      };
    });
    // The ranked come first, by their place, then the others who are here, then those who have left,
    // each by total. The sort is stable, so ties keep the order in which the players entered.
    const place = (standing: StandingView) => standing.rank ?? Infinity;
    standings.sort((a, b) => place(a) - place(b) || Number(a.left) - Number(b.left) || b.total - a.total);
    // The game in focus is the next one, unless the one that has just ended was scored.
    return {
      id: this.id,
      rules: { ...this.rules },
      played: this.#played,
      status: this.#status,
      game: Math.max(
        1,
        Math.min(this.rules.games, !scoredNow && this.#status === 'on' ? this.#played + 1 : this.#played),
      ),
      standings,
    };
  }
}
