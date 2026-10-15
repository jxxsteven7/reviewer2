import {
  TEAMS,
  type AgentPersona,
  type KeywordsReplay,
  type ReplayGroup,
  type ReplayMember,
  type ReplayPerson,
  type ShownReplay,
  type Team,
} from '@reviewer2/shared';
import type { GameContext, KeptReplay } from '../../core/game';
import type { GameLogData } from '../../core/gameLog';
import type { KeywordsData } from './index';
import { seatOf } from './seats';
import { copyRecord } from './state';

// The replays of the team word guessing game (docs/architecture.md#replays): what the server keeps
// of a game that finished (GameModule.replay), and how an account that played in it sees it
// (GameModule.showReplay).

// The game that has just ended, to watch again (shared/src/games/keywords/replay.ts): the whole
// board with its colors, the record of the clues and the guesses, the groups as the game ended, in
// the order of the room, and who everyone in them was, and whoever gave a clue or revealed a card
// and has left since: an account as no more than that, a guess by number, and an AI player by its
// persona. A withdrawn game is nothing to watch.
export function keptReplay(data: KeywordsData, ctx: GameContext): KeywordsReplay | null {
  const game = data.game;
  if (!game?.result || game.result.winner === null) return null;
  const ids = ctx.playerIds();
  const groups = TEAMS.map((team): ReplayGroup => {
    const inSeat = (role: 'captain' | 'guesser') =>
      ids.filter((id) => {
        const seat = seatOf(data.seating, id);
        return seat.team === team && seat.role === role;
      });
    return { team, captain: inSeat('captain')[0] ?? null, guessers: inSeat('guesser') };
  });
  const members: Record<string, ReplayMember> = {};
  for (const id of [...groupIds(groups), ...historyIds(game.history)]) {
    const who = members[id] === undefined ? ctx.whoIs(id) : null;
    if (who) members[id] = who;
  }
  return {
    gameId: game.gameId,
    language: game.language,
    startingTeam: game.startingTeam,
    cards: game.cards.map(({ word, color }) => ({ word, color })),
    history: game.history.map(copyRecord),
    result: { ...game.result },
    groups,
    members,
  };
}

// A kept replay as an account sees it: the groups, as kept or, for a replay from before they were,
// worked out from the record of the game, and who everyone was. An account that played is shown as
// it is now, and one deleted since as deleted; a guest by their number; an AI player by its
// persona. A replay from before keeps no more than the names of those who revealed a card, which
// are never shown: a player there whose account is gone can't be told from a guest, so each of them
// is shown as a guest, numbered in the order of the seats. Someone a new replay doesn't know is left
// out, as a player who left.
export function shownReplay({ replay: kept, log, accounts, viewer }: KeptReplay): ShownReplay {
  const replay = kept as KeywordsReplay;
  const groups = replay.groups ?? groupsFromLog(log, replay) ?? groupsFromHistory(replay);
  const agents: Record<string, string> = { ...log?.agents, ...replay.agents };
  const people: Record<string, ReplayPerson> = {};
  let guests = 0;
  for (const id of [...groupIds(groups), ...historyIds(replay.history)]) {
    if (people[id]) continue;
    const account = accounts.get(id);
    const member = replay.members?.[id];
    if (account) {
      people[id] = {
        name: account.username,
        ...(account.avatar === null ? {} : { avatar: account.avatar }),
        handle: account.handle,
      };
    } else if (member) {
      people[id] = 'account' in member ? { deleted: true } : { ...member };
    } else if (agents[id]) {
      people[id] = { agent: agents[id] as AgentPersona };
    } else if (!replay.members) {
      guests += 1;
      people[id] = { guest: guests };
    }
  }
  const me = groupIds(groups).find((id) => viewer.has(id)) ?? [...viewer].find((id) => people[id]) ?? null;
  return {
    gameId: replay.gameId,
    language: replay.language,
    startingTeam: replay.startingTeam,
    cards: replay.cards,
    history: replay.history,
    result: replay.result,
    groups,
    people,
    me,
  };
}

// Everyone in the groups: each group's PI, then its students.
const groupIds = (groups: readonly ReplayGroup[]) =>
  groups.flatMap(({ captain, guessers }) => [...(captain === null ? [] : [captain]), ...guessers]);

// Everyone who gave a clue or revealed a card, in the order they did.
const historyIds = (history: KeywordsReplay['history']) =>
  history.flatMap((record) => [
    ...(record.captain === undefined ? [] : [record.captain]),
    ...record.guesses.map(({ player }) => player),
  ]);

// The groups from the record of the game: where everyone sat when it began, and the group that each
// player who came during the game and gave a clue or revealed a card was seated in. Null without a
// record, as for the games from before there were any.
function groupsFromLog(log: GameLogData | null, replay: KeywordsReplay): ReplayGroup[] | null {
  if (!log?.start) return null;
  const groups = TEAMS.map((team): ReplayGroup => ({ team, captain: null, guessers: [] }));
  const place = (id: string, seat: unknown) => {
    const { team, role } = (seat ?? {}) as { team?: Team | null; role?: string };
    const group = groups.find((each) => each.team === team);
    if (!group) return;
    if (role === 'captain') group.captain ??= id;
    else if (role === 'guesser' && !group.guessers.includes(id)) group.guessers.push(id);
  };
  for (const [id, seat] of Object.entries(log.start)) place(id, seat);
  const played = new Set(historyIds(replay.history));
  for (const entry of log.entries) {
    if (entry.type !== 'join' || entry.by === null || !played.has(entry.by)) continue;
    place(entry.by, (entry.data as { seat?: unknown } | undefined)?.seat);
  }
  return groups;
}

// The groups from the clues and the guesses alone, for a game without a record: whoever gave a
// group's clues was its PI, and whoever revealed its cards one of its students.
function groupsFromHistory(replay: KeywordsReplay): ReplayGroup[] {
  return TEAMS.map((team): ReplayGroup => {
    const records = replay.history.filter((record) => record.team === team);
    const captain = records.find((record) => record.captain !== undefined)?.captain ?? null;
    const guessers = [...new Set(records.flatMap((record) => record.guesses.map(({ player }) => player)))];
    return { team, captain, guessers: guessers.filter((id) => id !== captain) };
  });
}
