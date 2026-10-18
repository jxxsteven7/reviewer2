import { TEAMS } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { fakeGame } from '../../../test/fakeGame';
import { testWords } from '../../../test/helpers';
import type { PracticeRequest } from '@reviewer2/shared/schemas';
import type { GameModule } from '../../core/game';
import { seededRng } from '../../core/random';
import { Rooms } from '../../core/rooms';
import { keywordsGame, type KeywordsData } from './index';
import { seatOf } from './seats';

// Practice rooms (docs/architecture.md#practice-rooms), as the list of rooms makes them for the
// first game: for the player alone, who sits in the role they chose with Reviewer 1 in the other
// seats, and for the player with friends, a waiting room, where the chair may invite Reviewer 1
// whatever their account.

// Ann, whose account the operator hasn't let have AI players.
const ann = {
  username: 'Ann',
  account: { id: 1, handle: 'a1b2c3d4e5f6', avatar: null, rank: 'undergraduate' as const, agents: false },
};

const roomsWith = (agents: { up: boolean } | null) =>
  new Rooms(testWords(), seededRng(3), () => 0, undefined, null, agents);

const create = (rooms: Rooms, practice: PracticeRequest, game: GameModule = keywordsGame) =>
  rooms.create({ game, language: 'en', fields: ['general'], key: 'ann', as: ann, practice });

const agentsOf = (room: { members: Map<string, { id: string; agent: string | null }> }) =>
  [...room.members.values()].filter((member) => member.agent !== null);

describe('practice rooms', () => {
  test('seat the player alone in the role they chose, and Reviewer 1 in the other three seats', () => {
    const created = create(roomsWith({ up: true }), { who: 'me', role: 'guesser' });
    if (!created.ok) throw new Error(created.error);
    const { room, member } = created;
    expect(room.practice).toBe(true);
    expect(room.agentsAllowed()).toBe(true);
    const data = room.data as KeywordsData;
    expect(seatOf(data.seating, member.id)).toEqual({ team: 'red', role: 'guesser' });
    // The red group's other seat first, so that a person sits before any AI player does.
    expect(agentsOf(room).map((agent) => seatOf(data.seating, agent.id))).toEqual([
      { team: 'red', role: 'captain' },
      { team: 'blue', role: 'captain' },
      { team: 'blue', role: 'guesser' },
    ]);
  });

  test('open a waiting room for the player with friends, where the chair invites Reviewer 1 seat by seat', () => {
    const created = create(roomsWith({ up: true }), { who: 'friends' });
    if (!created.ok) throw new Error(created.error);
    const { room, member } = created;
    expect(room.practice).toBe(true);
    expect(room.phase).toBe('lobby');
    expect(agentsOf(room)).toHaveLength(0);
    // The creator has come to play, and is dealt into a group as a student, as in a room from the
    // home page's "New room"; they may change seats.
    const seat = seatOf((room.data as KeywordsData).seating, member.id);
    expect(TEAMS).toContain(seat.team);
    expect(seat.role).toBe('guesser');
    // Reviewer 1 may be invited, although Ann's account may not have AI players elsewhere.
    expect(room.agentsAllowed()).toBe(true);
    const other = seat.team === 'red' ? 'blue' : 'red';
    const added = room.addAgent('reviewer1', { team: other, role: 'captain' });
    expect(added.ok).toBe(true);
    expect(agentsOf(room)).toHaveLength(1);
    expect(room.phase).toBe('lobby');
  });

  test('refuse a room while the agent is down, for a role the game has not, and for a game without them', () => {
    const down = roomsWith({ up: false });
    expect(create(down, { who: 'me', role: 'captain' })).toMatchObject({ ok: false, error: 'agents_offline' });
    expect(create(down, { who: 'friends' })).toMatchObject({ ok: false, error: 'agents_offline' });
    expect(create(roomsWith(null), { who: 'friends' })).toMatchObject({ ok: false, error: 'agents_offline' });
    const up = roomsWith({ up: true });
    expect(create(up, { who: 'me', role: 'spectator' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(create(up, { who: 'friends' }, fakeGame)).toMatchObject({ ok: false, error: 'bad_request' });
    expect(create(up, { who: 'me', role: 'player' }, fakeGame)).toMatchObject({ ok: false, error: 'bad_request' });
    // A refusal leaves no room behind.
    expect(down.size + up.size).toBe(0);
  });
});
