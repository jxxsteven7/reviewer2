import {
  defaultSettings,
  type KeywordsRoomData,
  type KeywordsSettings,
  type KeywordsView,
  type PlayerView,
  type RoomView,
  type Team,
} from '@reviewer2/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { TAKEOVER_MS } from '../src/core/agents';
import { WordLibrary } from '../src/core/words';
import { keywordsGame, type KeywordsData } from '../src/games/keywords';
import { CLUE_PACE_MS, GUESS_PACE_MS, STEP_PACE_MS } from '../src/games/keywords/agents';
import {
  Browser,
  createRoom,
  joinRoom,
  ScriptedAgent,
  SCRIPT_NOTE,
  scriptedPlay,
  startServer,
  TestClient,
  until,
  type Reply,
  type TestServer,
} from './helpers';

// AI players over real sockets (docs/architecture.md#ai-players): who may invite them, where they
// sit, how they play their turns and what they are told, an AI that plays for someone offline, and
// what a game with them leaves on the record. The agent plays by a script (ScriptedAgent), and the
// server's clock moves only when a test moves it, so every pace and every wait is exact.

let server: TestServer;
let agent: ScriptedAgent;
let clients: TestClient[];

beforeEach(async () => {
  agent = new ScriptedAgent();
  server = await startServer({ games: [keywordsGame], words: library(), agent });
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.close();
  await server.close();
});

// Sixty words of which no two clash, as in keywords.test.ts.
function library(): WordLibrary {
  const tag = (i: number) =>
    `w${String.fromCharCode(0x61 + Math.floor(i / 26))}${String.fromCharCode(0x61 + (i % 26))}`;
  return new WordLibrary([
    {
      id: 'general',
      name: { zh: 'G', en: 'G' },
      terms: Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, en: `general ${tag(i)}` })),
    },
  ]);
}

const track = (client: TestClient) => {
  clients.push(client);
  return client;
};
const roomData = (state: RoomView) => state.data as KeywordsRoomData;
const data = (client: TestClient) => roomData(client.state as RoomView);
const aiOf = (state: RoomView) => state.players.filter((player) => player.agent);
const board = (client: TestClient) => data(client).game as KeywordsView;
const roomOf = (code: string) => {
  const room = server.app.rooms.find(code);
  if (!room) throw new Error(`no room ${code}`);
  return room;
};
// The game as the server has it, with every color, for the script to know what a student doesn't.
const truth = (code: string) => {
  const game = (roomOf(code).data as KeywordsData).game;
  if (!game) throw new Error('no game');
  return game;
};
const agentsIn = (client: TestClient) => aiOf(client.state as RoomView);

async function expectOk(reply: Promise<Reply>) {
  expect(await reply).toEqual({ ok: true });
}

// A chair with an account, which the operator has let have AI players unless `allowed` is false, in
// a new room of the game.
async function chairRoom(allowed = true, settings: Partial<KeywordsSettings> = {}) {
  const browser = new Browser(server.url);
  const registered = await browser.register('Ann');
  if (!registered.body.ok) throw new Error('could not register');
  const account = server.accounts.byName('Ann');
  if (!account) throw new Error('no account');
  if (allowed) server.accounts.store.setAgents(account.id, true);
  const chair = track(await browser.connect());
  const reply = await chair.send('room:create', {
    game: 'keywords',
    language: 'en',
    fields: ['general'],
    settings: { ...defaultSettings('en'), ...settings },
  });
  if (!reply.ok) throw new Error(`could not create a room: ${reply.error}`);
  const code = reply.code as string;
  await chair.waitFor((state) => state.code === code);
  return { chair, code, roomId: reply.roomId as string };
}

const invite = (chair: TestClient, team: Team, role: 'captain' | 'guesser') =>
  chair.send('room:addAgent', { persona: 'reviewer1', seat: { team, role } });

async function start(chair: TestClient) {
  await chair.waitFor((state) => roomData(state).startProblems.length === 0, 'ready');
  await expectOk(chair.send('room:start', { round: chair.state?.round }));
  await chair.waitFor((state) => state.phase === 'playing', 'the game');
}

// Plays a turn of people: the PI gives a clue of one card, and the student reveals a paper that is
// no group's, which ends the turn.
async function peopleTurn(code: string, captain: TestClient, guesser: TestClient) {
  const game = truth(code);
  const moment = { gameId: game.gameId, turn: game.turn };
  await expectOk(captain.send('keywords:clue', { ...moment, word: 'zebra', count: 1 }));
  const paper = game.cards.findIndex((card) => card.color === 'neutral' && !card.revealed);
  await expectOk(guesser.send('keywords:reveal', { ...moment, card: paper }));
}

describe('inviting AI players', () => {
  test('takes a chair whose account the operator lets have them, in a private room', async () => {
    const { chair: guest, code } = await createRoom(server.url, 'Gus', { game: 'keywords' });
    track(guest);
    expect(guest.state?.agents).toBe(false);
    expect(await invite(guest, 'red', 'captain')).toEqual({ ok: false, error: 'agents_not_allowed' });
    expect(roomOf(code).members.size).toBe(1);

    const { chair: barred } = await chairRoom(false);
    expect(barred.state?.agents).toBe(false);
    expect(await invite(barred, 'red', 'captain')).toEqual({ ok: false, error: 'agents_not_allowed' });
  });

  test('seats one AI PI and one AI student in each group at most, who is online while the agent is', async () => {
    const { chair, code } = await chairRoom();
    await until(() => chair.state?.agents === true, 'the agent');
    await expectOk(invite(chair, 'red', 'captain'));
    await expectOk(invite(chair, 'red', 'guesser'));
    expect(await invite(chair, 'red', 'captain')).toEqual({ ok: false, error: 'agent_limit' });
    expect(await invite(chair, 'red', 'guesser')).toEqual({ ok: false, error: 'agent_limit' });
    expect(
      await chair.send('room:addAgent', { persona: 'reviewer1', seat: { team: null, role: 'spectator' } }),
    ).toEqual({
      ok: false,
      error: 'bad_seat',
    });
    expect(await chair.send('room:addAgent', { persona: 'reviewer9', seat: { team: 'red', role: 'guesser' } })).toEqual(
      {
        ok: false,
        error: 'bad_request',
      },
    );
    const state = await chair.waitFor((view) => aiOf(view).length === 2);
    const ai = aiOf(state);
    expect(ai.map(({ name, online, agent: persona }) => ({ name, online, persona }))).toEqual([
      { name: 'reviewer1', online: true, persona: 'reviewer1' },
      { name: 'reviewer1', online: true, persona: 'reviewer1' },
    ]);
    expect(ai.map((player) => data(chair).seats[player.id])).toEqual([
      { team: 'red', role: 'captain' },
      { team: 'red', role: 'guesser' },
    ]);
    expect(server.logs).toContainEqual({ event: 'agent_added', fields: { code, persona: 'reviewer1' } });
    // The operator counts them apart from the people.
    expect(server.app.stats()).toMatchObject({
      players: { online: 1, offline: 0 },
      agents: { players: 2, up: true, steps: 0, failures: 0 },
    });
    // Only the chair invites them.
    const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
    expect(await invite(bob, 'blue', 'captain')).toEqual({ ok: false, error: 'not_chair' });
  });

  test('keeps a room with AI players private and out of matches', async () => {
    const { chair } = await chairRoom();
    await until(() => chair.state?.agents === true, 'the agent');
    await expectOk(invite(chair, 'red', 'captain'));
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: false, error: 'agents_in_room' });
  });
});

describe('an AI player in the room', () => {
  test('never chairs it, watches or keeps it open, and goes when the chair removes it', async () => {
    const { chair, code } = await chairRoom();
    await until(() => chair.state?.agents === true, 'the agent');
    await expectOk(invite(chair, 'red', 'captain'));
    await expectOk(invite(chair, 'blue', 'captain'));
    const [red, blue] = agentsIn(chair) as PlayerView[];
    expect(await chair.send('room:chair', { playerId: red?.id })).toEqual({ ok: false, error: 'player_is_agent' });
    expect(await chair.send('room:spectate', { playerId: red?.id })).toEqual({ ok: false, error: 'player_is_agent' });
    await expectOk(chair.send('room:remove', { playerId: blue?.id }));
    expect(agentsIn(chair).map((player) => player.id)).toEqual([red?.id]);
    // It may come back: an AI player stays out by nothing.
    await expectOk(invite(chair, 'blue', 'captain'));
    // The AI players go with the last person, and the room with them.
    await expectOk(chair.send('room:leave'));
    expect(server.app.rooms.find(code)).toBeUndefined();
  });

  test('needs time limits and a person in a group before a game can start', async () => {
    const { chair } = await chairRoom(true, { clueTime: 0 });
    await until(() => chair.state?.agents === true, 'the agent');
    await expectOk(invite(chair, 'red', 'captain'));
    await expectOk(invite(chair, 'red', 'guesser'));
    await expectOk(invite(chair, 'blue', 'captain'));
    await expectOk(invite(chair, 'blue', 'guesser'));
    const state = await chair.waitFor((view) => aiOf(view).length === 4);
    expect(roomData(state).startProblems).toEqual([{ problem: 'needs_timers' }, { problem: 'needs_human' }]);
    expect(await chair.send('room:start', { round: chair.state?.round })).toEqual({ ok: false, error: 'cannot_start' });
  });
});

// Ann chairs and is the blue PI, Bob is a blue student, and the red group is two AI players.
async function againstAi() {
  const { chair: ann, code } = await chairRoom();
  await until(() => ann.state?.agents === true, 'the agent');
  const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
  await expectOk(ann.send('keywords:seat', { team: 'blue', role: 'captain' }));
  await expectOk(bob.send('keywords:seat', { team: 'blue', role: 'guesser' }));
  await expectOk(invite(ann, 'red', 'captain'));
  await expectOk(invite(ann, 'red', 'guesser'));
  await start(ann);
  if (truth(code).team === 'blue') {
    await peopleTurn(code, ann, bob);
    await ann.waitFor((state) => roomData(state).game?.team === 'red', 'the red turn');
  }
  return { ann, bob, code };
}

describe('the AI players of a group', () => {
  test('give the clue at their pace, with the cards it is meant for, and play the guesses', async () => {
    const { ann, code } = await againstAi();
    await until(() => agent.questions.some((request) => request.kind === 'clue'), 'the clue question');
    const clueQuestion = agent.questions.find((request) => request.kind === 'clue');
    // The PI's question shows every color, as the PI's own view does.
    expect(clueQuestion?.cards.every((card) => card.color !== undefined)).toBe(true);
    expect(clueQuestion).toMatchObject({ v: 1, persona: 'reviewer1', team: 'red', language: 'en' });
    const reds = truth(code)
      .cards.flatMap((card, i) => (card.color === 'red' ? [i] : []))
      .slice(0, 2);
    server.advance(CLUE_PACE_MS - 1);
    expect(truth(code).phase).toBe('clue');
    // The student reveals the two cards of the clue.
    agent.play = (request) =>
      request.kind === 'guess'
        ? { ok: true, kind: 'guess', picks: reds, reason: 'Both are stripy.', note: SCRIPT_NOTE }
        : { ok: true, kind: 'clue', word: 'zebra', count: 2, targets: reds, note: SCRIPT_NOTE };
    server.advance(1);
    await ann.waitFor((state) => roomData(state).game?.clue?.word === 'zebra', 'the clue');
    const guessQuestion = await (async () => {
      await until(() => agent.questions.some((request) => request.kind === 'guess'), 'the guess question');
      return agent.questions.find((request) => request.kind === 'guess');
    })();
    // A student is told no color of a card that is face down.
    expect(guessQuestion?.cards.filter((card) => !card.revealed).every((card) => card.color === undefined)).toBe(true);
    expect(guessQuestion).toMatchObject({ clue: { word: 'zebra', count: 2 } });
    server.advance(GUESS_PACE_MS);
    await until(() => truth(code).cards[reds[0] as number]?.revealed === true, 'the first card');
    expect(truth(code).cards[reds[1] as number]?.revealed).toBe(false);
    server.advance(STEP_PACE_MS);
    await until(() => truth(code).cards[reds[1] as number]?.revealed === true, 'the second card');
    // With its cards revealed, the student ends the turn.
    server.advance(STEP_PACE_MS);
    await until(() => truth(code).team === 'blue', 'the turn to end');
    expect(truth(code).history.at(-1)).toMatchObject({ word: 'zebra', targets: reds, guesses: [{}, {}] });
  });

  test('advise a person of the group, who reveals the cards', async () => {
    const { chair: ann, code } = await chairRoom();
    await until(() => ann.state?.agents === true, 'the agent');
    const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
    const cat = track(await joinRoom(server.url, code, 'Cat', { play: true }));
    await expectOk(ann.send('keywords:seat', { team: 'blue', role: 'captain' }));
    await expectOk(bob.send('keywords:seat', { team: 'blue', role: 'guesser' }));
    await expectOk(cat.send('keywords:seat', { team: 'red', role: 'guesser' }));
    await expectOk(invite(ann, 'red', 'captain'));
    await expectOk(invite(ann, 'red', 'guesser'));
    await start(ann);
    if (truth(code).team === 'blue') await peopleTurn(code, ann, bob);
    const reds = truth(code)
      .cards.flatMap((card, i) => (card.color === 'red' ? [i] : []))
      .slice(0, 2);
    agent.play = (request) =>
      request.kind === 'guess'
        ? { ok: true, kind: 'guess', picks: reds, reason: 'Both are stripy.', note: SCRIPT_NOTE }
        : { ok: true, kind: 'clue', word: 'zebra', count: 2, targets: reds, note: SCRIPT_NOTE };
    server.advance(CLUE_PACE_MS);
    await until(() => truth(code).phase === 'guess', 'the clue');
    const ai = (agentsIn(ann) as PlayerView[]).find((player) => data(ann).seats[player.id]?.role === 'guesser');
    // The AI student chooses its card for the group to see and says why, and reveals nothing.
    await cat.waitFor((state) => {
      const game = roomData(state).game;
      return game?.selections?.some((choice) => choice.player === ai?.id && choice.card === reds[0]) === true;
    }, 'the advice');
    await cat.waitFor(
      (state) => roomData(state).game?.chat?.some((line) => line.text === 'Both are stripy.') === true,
      'the reason',
    );
    server.advance(60_000, false);
    expect(truth(code).guessesMade).toBe(0);
    // Once the group reveals that card, it advises the next.
    const game = board(cat);
    await expectOk(cat.send('keywords:reveal', { gameId: game.gameId, turn: game.turn, card: reds[0] }));
    await cat.waitFor((state) => {
      const view = roomData(state).game;
      return view?.selections?.some((choice) => choice.player === ai?.id && choice.card === reds[1]) === true;
    }, 'the next advice');
    expect(board(cat).chat?.filter((line) => line.player === ai?.id)).toHaveLength(1);
  });

  test('drop an answer that comes after the game has moved on', async () => {
    const { ann, code } = await againstAi();
    agent.hold();
    await until(() => agent.questions.some((request) => request.kind === 'clue'), 'the clue question');
    const { turn } = truth(code);
    // The turn's time runs out while the agent thinks.
    server.advance(defaultSettings('en').firstClueTime * 1000);
    await until(() => truth(code).turn === turn + 1, 'the turn to end');
    agent.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    server.advance(CLUE_PACE_MS);
    expect(truth(code).history.at(-1)).toMatchObject({ word: null, timedOut: true });
    expect(ann.state?.phase).toBe('playing');
  });

  test('go offline when the agent fails, until it answers again', async () => {
    const { ann } = await againstAi();
    await until(() => agent.questions.some((request) => request.kind === 'clue'), 'the clue question');
    // The student's question, which comes with the clue, finds the agent gone.
    agent.up = false;
    server.advance(CLUE_PACE_MS);
    await until(() => agent.questions.some((request) => request.kind === 'guess'), 'the guess question');
    await ann.waitFor(
      (state) => state.players.filter((player) => player.agent).every((player) => !player.online),
      'offline',
    );
    expect(server.logs.some(({ event }) => event === 'agent_down')).toBe(true);
    expect(server.logs).toContainEqual(expect.objectContaining({ event: 'agent_failed' }));
    agent.up = true;
    server.advance(30_000);
    await ann.waitFor(
      (state) => state.players.filter((player) => player.agent).every((player) => player.online),
      'online',
    );
    expect(server.app.sockets.agents()).toMatchObject({ up: true, failures: 1 });
  });
});

describe('an AI that plays for someone offline', () => {
  test('plays their turn once they have been offline long enough, and stops when they are back', async () => {
    const { chair: ann, code, roomId } = await chairRoom();
    await until(() => ann.state?.agents === true, 'the agent');
    const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
    const cat = track(await joinRoom(server.url, code, 'Cat', { play: true }));
    const dan = track(await joinRoom(server.url, code, 'Dan', { play: true }));
    await expectOk(ann.send('keywords:seat', { team: 'blue', role: 'captain' }));
    await expectOk(bob.send('keywords:seat', { team: 'blue', role: 'guesser' }));
    await expectOk(cat.send('keywords:seat', { team: 'red', role: 'captain' }));
    await expectOk(dan.send('keywords:seat', { team: 'red', role: 'guesser' }));
    await start(ann);
    if (truth(code).team === 'blue') await peopleTurn(code, ann, bob);
    await ann.waitFor((state) => roomData(state).game?.team === 'red', 'the red turn');
    const catId = cat.me;
    const token = cat.token;
    cat.close();
    await ann.waitFor((state) => state.players.find((player) => player.id === catId)?.online === false, 'Cat offline');
    server.advance(TAKEOVER_MS - 1);
    expect(ann.state?.players.find((player) => player.id === catId)?.takenOver).toBeUndefined();
    server.advance(1);
    await ann.waitFor(
      (state) => state.players.find((player) => player.id === catId)?.takenOver === true,
      'the takeover',
    );
    await until(() => agent.questions.some((request) => request.kind === 'clue'), 'the clue question');
    server.advance(CLUE_PACE_MS);
    await until(() => truth(code).phase === 'guess', 'the clue');
    expect(truth(code).history.at(-1)).toMatchObject({ word: 'zebra', captain: catId });
    // Back: the AI stops, and nobody sees Cat played for any more.
    const back = track(await TestClient.connect(server.url, { token, code, roomId }));
    await back.waitFor((state) => state.me === catId, 'Cat back');
    await ann.waitFor(
      (state) => state.players.find((player) => player.id === catId)?.takenOver === undefined,
      'handed back',
    );
  });

  test('leaves the turn to the people of the group who are there', async () => {
    const { chair: ann, code } = await chairRoom();
    await until(() => ann.state?.agents === true, 'the agent');
    const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
    const cat = track(await joinRoom(server.url, code, 'Cat', { play: true }));
    const dan = track(await joinRoom(server.url, code, 'Dan', { play: true }));
    const eve = track(await joinRoom(server.url, code, 'Eve', { play: true }));
    await expectOk(ann.send('keywords:seat', { team: 'blue', role: 'captain' }));
    await expectOk(bob.send('keywords:seat', { team: 'blue', role: 'guesser' }));
    await expectOk(cat.send('keywords:seat', { team: 'red', role: 'captain' }));
    await expectOk(dan.send('keywords:seat', { team: 'red', role: 'guesser' }));
    await expectOk(eve.send('keywords:seat', { team: 'red', role: 'guesser' }));
    await start(ann);
    if (truth(code).team === 'blue') await peopleTurn(code, ann, bob);
    const game = truth(code);
    await expectOk(cat.send('keywords:clue', { gameId: game.gameId, turn: game.turn, word: 'zebra', count: 1 }));
    dan.close();
    server.advance(TAKEOVER_MS + GUESS_PACE_MS);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Dan is played for, but Eve can play the guesses herself: no AI asks or reveals for him.
    expect(agent.questions.filter((request) => request.kind === 'guess')).toEqual([]);
    expect(truth(code).guessesMade).toBe(0);
  });
});

describe('a game that an AI played in', () => {
  test('brings nobody points, a streak or a friend title, and is kept with the AI log beside its own', async () => {
    // The AI student reveals Reviewer 2 at once, which ends the game.
    agent.play = (request) => {
      if (request.kind === 'clue') return scriptedPlay(request);
      const cards = (server.app.rooms.all()[0]?.data as KeywordsData).game?.cards ?? [];
      const reviewer2 = cards.findIndex((card) => card.color === 'reviewer2');
      return { ok: true, kind: 'guess', picks: [reviewer2], reason: 'A hunch.', note: SCRIPT_NOTE };
    };
    const { ann, code } = await againstAi();
    const reviewer2 = truth(code).cards.findIndex((card) => card.color === 'reviewer2');
    const reds = truth(code)
      .cards.flatMap((card, i) => (card.color === 'red' ? [i] : []))
      .slice(0, 2);
    server.advance(CLUE_PACE_MS);
    await until(() => truth(code).phase === 'guess', 'the clue');
    await until(() => agent.questions.some((request) => request.kind === 'guess'), 'the guess question');
    server.advance(GUESS_PACE_MS);
    await ann.waitFor((state) => state.phase === 'ended', 'the end');
    const account = server.accounts.byName('Ann');
    const records = server.db
      .prepare('SELECT points, won FROM game_records WHERE account_id = ?')
      .all(account?.id ?? 0);
    expect(records).toEqual([{ points: 0, won: 1 }]);
    expect(server.db.prepare('SELECT * FROM streaks WHERE account_id = ?').all(account?.id ?? 0)).toEqual([]);
    const [row] = server.db.prepare('SELECT log, agent_log AS agentLog FROM replays').all() as {
      log: string;
      agentLog: string;
    }[];
    const log = JSON.parse(row?.log ?? '{}') as { agents: Record<string, string> };
    expect(Object.values(log.agents)).toEqual(['reviewer1', 'reviewer1']);
    const agentLog = JSON.parse(row?.agentLog ?? '{}') as { steps: { kind: string; answer: unknown }[] };
    expect(agentLog.steps.map(({ kind, answer }) => ({ kind, answer }))).toEqual([
      { kind: 'clue', answer: { word: 'zebra', count: 2, targets: reds } },
      { kind: 'guess', answer: { picks: [reviewer2], reason: 'A hunch.' } },
    ]);
  });
});
