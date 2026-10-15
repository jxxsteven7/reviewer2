import {
  SPECTATOR,
  TEAMS,
  type AgentPersona,
  type ClueCount,
  type KeywordsReplay,
  type KeywordsSettings,
  type Language,
  type ReplayCard,
  type ReplayGroup,
  type ReplayPerson,
  type Seat,
  type ShownReplay,
  type Team,
} from '@reviewer2/shared';
import type { KeptReplay } from '../../core/game';
import type { GameLogData } from '../../core/gameLog';
import {
  applyClue,
  applyExtension,
  applyPause,
  applyResume,
  applyReveal,
  applyTimeout,
  beginGame,
  endTurn,
} from './rules';
import type { KeywordsState } from './state';

// The replays of the team word guessing game (docs/architecture.md#replays): a kept game as an
// account that played in it watches it again (GameModule.showReplay), worked out as it is opened
// from how the game began and its log. The log holds every move that changed the game, in order,
// and every seat taken, changed or left, so the game is played through again with them, by the
// functions that made the moves (rules.ts), which take each move as the rules took it then, and say
// what it was as the rules do now, such as a move in the last seconds of its phase.

// How a game began, as its record keeps it (GameModule.setup): the language and the settings, the
// group that started, and the board with every color.
export interface KeywordsSetup {
  language: Language;
  settings: KeywordsSettings;
  startingTeam: Team;
  cards: ReplayCard[];
}

// A seat as the log has it, where the game said a member was (GameModule.seated).
function seatIn(value: unknown): Seat {
  const { team, role } = (value ?? {}) as { team?: Team | null; role?: string };
  return team && TEAMS.includes(team) && (role === 'captain' || role === 'guesser') ? { team, role } : SPECTATOR;
}

// The game that a kept log tells, if it finished: the board, the record of the clues and the
// guesses, the result, and the groups as it ended, each PI and its students by player ID, in the
// order of the room. The seats are where everyone was as the game began, and then every seat that
// someone took as they came or by moving, every seat left for the spectators, by moving or by the
// chair's bench, and every seat of someone who left the room, removed or not. A PI who left the
// seat of their own accord while it stays empty is named on a clue that the time ran out on, as the
// game names them (KeywordsData.vacated): not one whom the chair benched. What the groups said
// after the end changes nothing. Null for a game that didn't finish.
export function replayOf(setup: KeywordsSetup, log: GameLogData): KeywordsReplay | null {
  let state: KeywordsState = beginGame(
    {
      gameId: log.gameId,
      settings: setup.settings,
      language: setup.language,
      startingTeam: setup.startingTeam,
      cards: setup.cards.map(({ word, color }) => ({ word, color, revealed: false })),
    },
    0,
  );
  const seats = new Map(Object.entries(log.start ?? {}).map(([id, seat]) => [id, seatIn(seat)]));
  const vacated: Record<Team, string | null> = { red: null, blue: null };
  const leaves = (id: string) => {
    const seat = seats.get(id);
    if (seat?.role === 'captain') vacated[seat.team] = id;
  };
  const captain = (team: Team) =>
    [...seats].find(([, seat]) => seat.team === team && seat.role === 'captain')?.[0] ?? null;
  for (const { t, by, type, data } of log.entries) {
    if (type === 'end') break;
    const carried = (data ?? {}) as Record<string, unknown>;
    if (type === 'join' && by !== null) {
      seats.set(by, seatIn(carried.seat));
    } else if (type === 'keywords:seat' && by !== null) {
      leaves(by);
      seats.set(by, seatIn(carried));
    } else if (type === 'leave' && by !== null) {
      leaves(by);
      seats.delete(by);
    } else if (type === 'bench') {
      const player = carried.player as string;
      if (player === by) leaves(player);
      seats.set(player, SPECTATOR);
    } else if (type === 'keywords:clue' && by !== null) {
      const { word, count, targets = [] } = carried as { word: string; count: ClueCount; targets?: number[] };
      state = applyClue(state, by, { word, count, targets }, t);
    } else if (type === 'keywords:reveal' && by !== null) {
      state = applyReveal(state, by, carried.card as number, t);
    } else if (type === 'keywords:pass') {
      state = endTurn(state, t);
    } else if (type === 'keywords:pause') {
      state = applyPause(state, t);
    } else if (type === 'keywords:resume') {
      state = applyResume(state, t);
    } else if (type === 'keywords:extend') {
      state = applyExtension(state);
    } else if (type === 'tick') {
      const blamed = captain(state.team) ?? vacated[state.team];
      state = applyTimeout(state, t, () => (blamed === null ? null : { captain: blamed, before: null }));
    }
  }
  if (!state.result || state.result.winner === null) return null;
  const inSeat = (team: Team, role: 'captain' | 'guesser') =>
    [...seats].filter(([, seat]) => seat.team === team && seat.role === role).map(([id]) => id);
  return {
    gameId: log.gameId,
    language: setup.language,
    startingTeam: setup.startingTeam,
    cards: setup.cards.map(({ word, color }) => ({ word, color })),
    history: state.history,
    result: state.result,
    groups: TEAMS.map((team): ReplayGroup => ({
      team,
      captain: inSeat(team, 'captain')[0] ?? null,
      guessers: inSeat(team, 'guesser'),
    })),
  };
}

// A kept game as an account sees it, if it finished, with who everyone in the groups and the record
// was: an account that played in it as it is now, and one deleted since as deleted (the log's
// `deleted`); an AI player by its persona, and a guest by their number in the room, as the log
// names them. Someone else, as an account that the log doesn't know any more, is left out. `me` is
// the player ID that the account watching had in the groups, or else in the record.
export function shownReplay({ setup, log, accounts, viewer }: KeptReplay): ShownReplay | null {
  const replay = replayOf(setup as KeywordsSetup, log);
  if (!replay) return null;
  const deleted = new Set(log.deleted);
  const people: Record<string, ReplayPerson> = {};
  for (const id of [...groupIds(replay.groups), ...historyIds(replay.history)]) {
    if (people[id]) continue;
    const account = accounts.get(id);
    const agent = log.agents?.[id];
    const guest = log.guests?.[id];
    if (account) {
      people[id] = {
        name: account.username,
        ...(account.avatar === null ? {} : { avatar: account.avatar }),
        handle: account.handle,
      };
    } else if (deleted.has(id)) {
      people[id] = { deleted: true };
    } else if (agent !== undefined) {
      people[id] = { agent: agent as AgentPersona };
    } else if (guest !== undefined) {
      people[id] = { guest };
    }
  }
  const me = groupIds(replay.groups).find((id) => viewer.has(id)) ?? [...viewer].find((id) => people[id]) ?? null;
  return { ...replay, people, me };
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
