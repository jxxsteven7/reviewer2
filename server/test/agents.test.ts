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
import { PING_MS, RETRY_MS, TAKEOVER_MS } from '../src/core/agents';
import type { GameLogData } from '../src/core/gameLog';
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
const playerIn = (state: RoomView | undefined, id: string) => state?.players.find((player) => player.id === id);
const guessQuestions = () => agent.questions.filter((request) => request.kind === 'guess');
// A moment for the answers of the agent, which come at once, to be sent on.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const NO_TIMERS: Partial<KeywordsSettings> = { firstClueTime: 0, clueTime: 0, guessTime: 0 };
const RULES = { games: 2, teams: 'switch', grouping: 'random' };

async function expectOk(reply: Promise<Reply>) {
  expect(await reply).toEqual({ ok: true });
}

// A chair with an account, which the operator has let have AI players unless `allowed` is false, in
// a new room of the game.
async function chairRoom(allowed = true, settings: Partial<KeywordsSettings> = {}, payload: object = {}, name = 'Ann') {
  const browser = new Browser(server.url);
  const registered = await browser.register(name);
  if (!registered.body.ok) throw new Error('could not register');
  const account = server.accounts.byName(name);
  if (!account) throw new Error('no account');
  if (allowed) server.accounts.store.setAgents(account.id, true);
  const chair = track(await browser.connect());
  const reply = await chair.send('room:create', {
    game: 'keywords',
    language: 'en',
    fields: ['general'],
    settings: { ...defaultSettings('en'), ...settings },
    ...payload,
  });
  if (!reply.ok) throw new Error(`could not create a room: ${reply.error}`);
  const code = reply.code as string;
  await chair.waitFor((state) => state.code === code);
  return { browser, chair, code, roomId: reply.roomId as string };
}

const invite = (chair: TestClient, team: Team, role: 'captain' | 'guesser') =>
  chair.send('room:addAgent', { persona: 'reviewer1', seat: { team, role } });
const seat = (client: TestClient, team: Team | null, role: 'captain' | 'guesser' | 'spectator') =>
  expectOk(client.send('keywords:seat', { team, role }));

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

// The first two of the red group's cards that are face down, which the script's clue aims at.
const redTargets = (code: string) =>
  truth(code)
    .cards.flatMap((card, i) => (card.color === 'red' && !card.revealed ? [i] : []))
    .slice(0, 2);

// A script that reveals the red group's two cards, as a student, and aims the clue at them.
function playReds(reds: number[]) {
  agent.play = (request) =>
    request.kind === 'guess'
      ? { ok: true, kind: 'guess', picks: reds, reason: 'Both are stripy.', note: SCRIPT_NOTE }
      : { ok: true, kind: 'clue', word: 'zebra', count: 2, targets: reds, note: SCRIPT_NOTE };
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

  test('seats one AI PI and one AI student in each group at most, once a person sits, online while the agent is', async () => {
    const { chair, code } = await chairRoom();
    await until(() => chair.state?.agents === true, 'the agent');
    // Nobody sits in a group yet: the room would be the AI players' alone.
    expect(await invite(chair, 'red', 'captain')).toEqual({ ok: false, error: 'needs_human' });
    await seat(chair, 'blue', 'captain');
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
    await seat(chair, 'blue', 'captain');
    await expectOk(invite(chair, 'red', 'captain'));
    expect(await chair.send('room:public', { public: true })).toEqual({ ok: false, error: 'agents_in_room' });

    // A match room has none, however the chair's account stands.
    const { chair: host } = await chairRoom(true, {}, { match: RULES }, 'Hal');
    await seat(host, 'blue', 'captain');
    expect(host.state?.agents).toBe(false);
    expect(await invite(host, 'red', 'captain')).toEqual({ ok: false, error: 'agents_not_allowed' });
  });
});

describe('an AI player in the room', () => {
  test('never chairs it or keeps it open, and goes when the chair removes it or sends it to watch', async () => {
    const { chair, code } = await chairRoom();
    await until(() => chair.state?.agents === true, 'the agent');
    await seat(chair, 'blue', 'guesser');
    await expectOk(invite(chair, 'red', 'captain'));
    await expectOk(invite(chair, 'blue', 'captain'));
    const [red, blue] = agentsIn(chair) as PlayerView[];
    expect(await chair.send('room:chair', { playerId: red?.id })).toEqual({ ok: false, error: 'player_is_agent' });
    // An AI player doesn't watch: sending it to the spectators removes it, as removing it does.
    await expectOk(chair.send('room:spectate', { playerId: red?.id }));
    expect(agentsIn(chair).map((player) => player.id)).toEqual([blue?.id]);
    await expectOk(chair.send('room:remove', { playerId: blue?.id }));
    expect(agentsIn(chair)).toEqual([]);
    // It may come back: an AI player stays out by nothing.
    await expectOk(invite(chair, 'blue', 'captain'));
    // The AI players go with the last person, and the room with them.
    await expectOk(chair.send('room:leave'));
    expect(server.app.rooms.find(code)).toBeUndefined();
  });

  test('needs time limits and a person in a group before a game can start', async () => {
    const { chair } = await chairRoom(true, { clueTime: 0 });
    await until(() => chair.state?.agents === true, 'the agent');
    await seat(chair, 'blue', 'captain');
    await expectOk(invite(chair, 'red', 'captain'));
    await expectOk(invite(chair, 'red', 'guesser'));
    await expectOk(invite(chair, 'blue', 'guesser'));
    // The chair stands up to watch: the AI players are alone in the groups.
    await seat(chair, null, 'spectator');
    const state = await chair.waitFor(
      (view) => aiOf(view).length === 3 && roomData(view).seats[view.me ?? '']?.team === null,
    );
    expect(roomData(state).startProblems).toEqual(
      expect.arrayContaining([{ problem: 'needs_timers' }, { problem: 'needs_human' }]),
    );
    expect(await chair.send('room:start', { round: chair.state?.round })).toEqual({ ok: false, error: 'cannot_start' });
  });

  test('is offline while the agent is down, which keeps a game from starting with it as a PI', async () => {
    const { ann, code } = await againstAi();
    await until(() => agent.questions.some((request) => request.kind === 'clue'), 'the clue question');
    // The agent goes, which the student's question finds, and the chair ends the game.
    agent.up = false;
    server.advance(CLUE_PACE_MS);
    await ann.waitFor((state) => aiOf(state).every((player) => !player.online), 'offline');
    await expectOk(ann.send('room:end', { gameId: truth(code).gameId }));
    await expectOk(ann.send('room:again', { gameId: ann.state?.gameId }));
    const lobby = await ann.waitFor((state) => state.phase === 'lobby', 'the waiting room');
    expect(roomData(lobby).startProblems).toContainEqual({ problem: 'captain_offline', team: 'red' });
    expect(await ann.send('room:start', { round: ann.state?.round })).toEqual({ ok: false, error: 'cannot_start' });
  });
});

// Ann chairs and is the blue PI, Bob is a blue student, and the red group is two AI players.
async function againstAi() {
  const { browser, chair: ann, code } = await chairRoom();
  await until(() => ann.state?.agents === true, 'the agent');
  const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
  await seat(ann, 'blue', 'captain');
  await seat(bob, 'blue', 'guesser');
  await expectOk(invite(ann, 'red', 'captain'));
  await expectOk(invite(ann, 'red', 'guesser'));
  await start(ann);
  if (truth(code).team === 'blue') {
    await peopleTurn(code, ann, bob);
    await ann.waitFor((state) => roomData(state).game?.team === 'red', 'the red turn');
  }
  return { browser, ann, bob, code };
}

// Ann chairs and is the blue PI, Bob is a blue student, and the red group is an AI PI, an AI
// student and Cat, a person, as a student. The game is at the red group's turn.
async function withCat() {
  const { chair: ann, code, roomId } = await chairRoom();
  await until(() => ann.state?.agents === true, 'the agent');
  const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
  const cat = track(await joinRoom(server.url, code, 'Cat', { play: true }));
  await seat(ann, 'blue', 'captain');
  await seat(bob, 'blue', 'guesser');
  await seat(cat, 'red', 'guesser');
  await expectOk(invite(ann, 'red', 'captain'));
  await expectOk(invite(ann, 'red', 'guesser'));
  await start(ann);
  if (truth(code).team === 'blue') await peopleTurn(code, ann, bob);
  await ann.waitFor((state) => roomData(state).game?.team === 'red', 'the red turn');
  const student = (agentsIn(ann) as PlayerView[]).find((player) => data(ann).seats[player.id]?.role === 'guesser');
  if (!student) throw new Error('no AI student');
  return { ann, bob, cat, code, roomId, student };
}

describe('the AI players of a group', () => {
  test('give the clue at their pace, with the cards it is meant for, and play the guesses', async () => {
    const { ann, code } = await againstAi();
    await until(() => agent.questions.some((request) => request.kind === 'clue'), 'the clue question');
    const clueQuestion = agent.questions.find((request) => request.kind === 'clue');
    // The PI's question shows every color, as the PI's own view does.
    expect(clueQuestion?.cards.every((card) => card.color !== undefined)).toBe(true);
    expect(clueQuestion).toMatchObject({ v: 1, persona: 'reviewer1', team: 'red', language: 'en' });
    const reds = redTargets(code);
    server.advance(CLUE_PACE_MS - 1);
    expect(truth(code).phase).toBe('clue');
    // The student reveals the two cards of the clue.
    playReds(reds);
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
    const { cat, code, student } = await withCat();
    const reds = redTargets(code);
    playReds(reds);
    server.advance(CLUE_PACE_MS);
    await until(() => truth(code).phase === 'guess', 'the clue');
    // The AI student chooses its card for the group to see and says why, and reveals nothing.
    await cat.waitFor((state) => {
      const game = roomData(state).game;
      return game?.selections?.some((choice) => choice.player === student.id && choice.card === reds[0]) === true;
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
      return view?.selections?.some((choice) => choice.player === student.id && choice.card === reds[1]) === true;
    }, 'the next advice');
    expect(board(cat).chat?.filter((line) => line.player === student.id)).toHaveLength(1);
  });

  test('keep advising while a person of the group drops for a moment, and play once they have been away', async () => {
    const { ann, cat, code, roomId, student } = await withCat();
    const reds = redTargets(code);
    playReds(reds);
    server.advance(CLUE_PACE_MS);
    await until(() => guessQuestions().length === 1, 'the advice question');
    await settle();
    expect(truth(code).selections.some((choice) => choice.player === student.id)).toBe(true);
    // Cat reloads her page: for the pace of a reveal and more, the AI asks nothing new and reveals
    // nothing, and when she is back, nothing has changed.
    const catId = cat.me;
    const token = cat.token;
    cat.close();
    await ann.waitFor((state) => playerIn(state, catId)?.online === false, 'Cat offline');
    server.advance(GUESS_PACE_MS + STEP_PACE_MS);
    await settle();
    expect(guessQuestions()).toHaveLength(1);
    expect(truth(code).guessesMade).toBe(0);
    const back = track(await TestClient.connect(server.url, { token, code, roomId }));
    await back.waitFor((state) => state.me === catId, 'Cat back');
    await settle();
    expect(guessQuestions()).toHaveLength(1);
    expect(board(back).chat?.filter((line) => line.player === student.id)).toHaveLength(1);
    // Away for as long as a takeover takes, she leaves the AI student alone in the group: it plays
    // the guesses itself, as itself, and nobody is played for.
    back.close();
    await ann.waitFor((state) => playerIn(state, catId)?.online === false, 'Cat offline again');
    server.advance(TAKEOVER_MS);
    await until(() => guessQuestions().length === 2, 'the question of the student alone');
    server.advance(GUESS_PACE_MS);
    await until(() => truth(code).cards[reds[0] as number]?.revealed === true, 'the first card');
    expect(truth(code).history.at(-1)?.guesses).toEqual([expect.objectContaining({ player: student.id })]);
    expect(playerIn(ann.state as RoomView, catId)?.takenOver).toBeUndefined();
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
    await settle();
    server.advance(CLUE_PACE_MS);
    expect(truth(code).history.at(-1)).toMatchObject({ word: null, timedOut: true });
    expect(ann.state?.phase).toBe('playing');
  });

  test('go offline when the agent fails, until it answers again, while the clock carries the game on', async () => {
    const { ann, code } = await againstAi();
    await until(() => agent.questions.some((request) => request.kind === 'clue'), 'the clue question');
    // The student's question, which comes with the clue, finds the agent gone.
    agent.up = false;
    server.advance(CLUE_PACE_MS);
    await until(() => agent.questions.some((request) => request.kind === 'guess'), 'the guess question');
    await ann.waitFor((state) => aiOf(state).every((player) => !player.online), 'offline');
    expect(server.logs.some(({ event }) => event === 'agent_down')).toBe(true);
    expect(server.logs).toContainEqual(expect.objectContaining({ event: 'agent_failed' }));
    // Nobody guesses: the turn ends when its time runs out.
    const { turn } = truth(code);
    server.advance(defaultSettings('en').guessTime * 1000);
    await until(() => truth(code).turn === turn + 1, 'the turn to end');
    expect(truth(code).history.find(({ word }) => word === 'zebra')).toMatchObject({ timedOut: true, guesses: [] });
    agent.up = true;
    server.advance(PING_MS);
    await ann.waitFor((state) => aiOf(state).every((player) => player.online), 'online');
    expect(server.app.sockets.agents()).toMatchObject({ up: true, failures: 1 });
  });

  test('stay online when the agent has no answer for a seat, which is asked again after a while', async () => {
    // The model is slow, or busy: the first request alone is lost.
    let asked = 0;
    agent.play = (request) => {
      asked += 1;
      return asked === 1 ? { ok: false, error: 'no_answer', note: SCRIPT_NOTE } : scriptedPlay(request);
    };
    const { ann, code } = await againstAi();
    await until(() => agent.questions.some((request) => request.kind === 'clue'), 'the clue question');
    await settle();
    expect(server.logs).toContainEqual(expect.objectContaining({ event: 'agent_failed' }));
    expect(server.logs.some(({ event }) => event === 'agent_down')).toBe(false);
    expect(aiOf(ann.state as RoomView).every((player) => player.online)).toBe(true);
    server.advance(RETRY_MS - 1);
    expect(agent.questions.filter((request) => request.kind === 'clue')).toHaveLength(1);
    server.advance(1);
    await until(() => agent.questions.filter((request) => request.kind === 'clue').length === 2, 'the second question');
    await ann.waitFor((state) => roomData(state).game?.clue?.word === 'zebra', 'the clue');
    expect(truth(code).phase).toBe('guess');
    expect(server.app.sockets.agents()).toMatchObject({ up: true, steps: 3, failures: 1 });
  });
});

// Ann chairs and is the blue PI, Bob is a blue student, and the red group is Cat, its PI, with
// `students` as its students, all people. The game is at the red group's turn.
async function people(students: string[], settings: Partial<KeywordsSettings> = {}) {
  const { browser, chair: ann, code, roomId } = await chairRoom(true, settings);
  await until(() => ann.state?.agents === true, 'the agent');
  const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
  const cat = track(await joinRoom(server.url, code, 'Cat', { play: true }));
  const reds: TestClient[] = [];
  for (const name of students) reds.push(track(await joinRoom(server.url, code, name, { play: true })));
  await seat(ann, 'blue', 'captain');
  await seat(bob, 'blue', 'guesser');
  await seat(cat, 'red', 'captain');
  for (const student of reds) await seat(student, 'red', 'guesser');
  await start(ann);
  if (truth(code).team === 'blue') await peopleTurn(code, ann, bob);
  await ann.waitFor((state) => roomData(state).game?.team === 'red', 'the red turn');
  return { browser, ann, bob, cat, reds, code, roomId };
}

// Someone's page goes, and the others see them offline.
async function goes(client: TestClient, watcher: TestClient) {
  const id = client.me;
  client.close();
  await watcher.waitFor((state) => playerIn(state, id)?.online === false, `${id} offline`);
  return id;
}

describe('an AI that plays for someone offline', () => {
  test('plays their turn once they have been offline long enough, and stops when they are back', async () => {
    const { ann, cat, code, roomId } = await people(['Dan']);
    const token = cat.token;
    const catId = await goes(cat, ann);
    server.advance(TAKEOVER_MS - 1);
    expect(playerIn(ann.state as RoomView, catId)?.takenOver).toBeUndefined();
    server.advance(1);
    await ann.waitFor((state) => playerIn(state, catId)?.takenOver === true, 'the takeover');
    await until(() => agent.questions.some((request) => request.kind === 'clue'), 'the clue question');
    server.advance(CLUE_PACE_MS);
    await until(() => truth(code).phase === 'guess', 'the clue');
    expect(truth(code).history.at(-1)).toMatchObject({ word: 'zebra', captain: catId });
    // Cat is still played for, with nothing to do until she is back.
    expect(playerIn(ann.state as RoomView, catId)?.takenOver).toBe(true);
    const back = track(await TestClient.connect(server.url, { token, code, roomId }));
    await back.waitFor((state) => state.me === catId, 'Cat back');
    await ann.waitFor((state) => playerIn(state, catId)?.takenOver === undefined, 'handed back');
  });

  test('leaves the turn to the people of the group who are there', async () => {
    const { ann, cat, reds, code } = await people(['Dan', 'Eve']);
    const [dan] = reds as [TestClient, TestClient];
    const game = truth(code);
    await expectOk(cat.send('keywords:clue', { gameId: game.gameId, turn: game.turn, word: 'zebra', count: 1 }));
    const danId = await goes(dan, ann);
    server.advance(TAKEOVER_MS + GUESS_PACE_MS);
    await settle();
    // Eve can play the guesses herself: no AI asks or reveals for Dan, and nobody is told that one does.
    expect(guessQuestions()).toEqual([]);
    expect(truth(code).guessesMade).toBe(0);
    expect(playerIn(ann.state as RoomView, danId)?.takenOver).toBeUndefined();
  });

  test('plays for one student of a group at most, when every one of them is offline', async () => {
    const { ann, cat, reds, code } = await people(['Dan', 'Eve']);
    const [dan, eve] = reds as [TestClient, TestClient];
    const targets = redTargets(code);
    playReds(targets);
    const game = truth(code);
    await expectOk(cat.send('keywords:clue', { gameId: game.gameId, turn: game.turn, word: 'zebra', count: 2 }));
    const danId = await goes(dan, ann);
    const eveId = await goes(eve, ann);
    server.advance(TAKEOVER_MS);
    await ann.waitFor((state) => playerIn(state, danId)?.takenOver === true, 'the takeover');
    await until(() => guessQuestions().length === 1, 'the question');
    await settle();
    // Dan, who came first, is played for; Eve isn't, since one student of a group plays the turn.
    expect(playerIn(ann.state as RoomView, eveId)?.takenOver).toBeUndefined();
    server.advance(GUESS_PACE_MS);
    await until(() => truth(code).guessesMade === 1, 'the first card');
    server.advance(STEP_PACE_MS);
    await until(() => truth(code).guessesMade === 2, 'the second card');
    expect(guessQuestions()).toHaveLength(1);
    expect(
      truth(code)
        .history.at(-1)
        ?.guesses.map(({ player }) => player),
    ).toEqual([danId, danId]);
  });

  test('leaves the guesses to the AI student of the group, when its people are offline', async () => {
    const { chair: ann, code } = await chairRoom();
    await until(() => ann.state?.agents === true, 'the agent');
    const bob = track(await joinRoom(server.url, code, 'Bob', { play: true }));
    const cat = track(await joinRoom(server.url, code, 'Cat', { play: true }));
    const dan = track(await joinRoom(server.url, code, 'Dan', { play: true }));
    await seat(ann, 'blue', 'captain');
    await seat(bob, 'blue', 'guesser');
    await seat(cat, 'red', 'captain');
    await seat(dan, 'red', 'guesser');
    await expectOk(invite(ann, 'red', 'guesser'));
    await start(ann);
    if (truth(code).team === 'blue') await peopleTurn(code, ann, bob);
    await ann.waitFor((state) => roomData(state).game?.team === 'red', 'the red turn');
    const student = agentsIn(ann)[0] as PlayerView;
    const targets = redTargets(code);
    playReds(targets);
    const game = truth(code);
    await expectOk(cat.send('keywords:clue', { gameId: game.gameId, turn: game.turn, word: 'zebra', count: 2 }));
    // While Dan is there, the AI student advises him.
    await until(() => guessQuestions().length === 1, 'the advice');
    const danId = await goes(dan, ann);
    server.advance(TAKEOVER_MS);
    // Without him, it plays the guesses itself: one AI plays for the group, and Dan isn't played for.
    await until(() => guessQuestions().length === 2, 'the question of the student alone');
    server.advance(GUESS_PACE_MS);
    await until(() => truth(code).guessesMade === 1, 'the first card');
    expect(truth(code).history.at(-1)?.guesses).toEqual([expect.objectContaining({ player: student.id })]);
    expect(playerIn(ann.state as RoomView, danId)?.takenOver).toBeUndefined();
    expect(guessQuestions()).toHaveLength(2);
  });

  test('asks again in a room without time limits, when the agent had no answer', async () => {
    const { ann, cat, code } = await people(['Dan'], NO_TIMERS);
    let asked = 0;
    agent.play = (request) => {
      asked += 1;
      return asked === 1 ? { ok: false, error: 'busy' } : scriptedPlay(request);
    };
    const catId = await goes(cat, ann);
    server.advance(TAKEOVER_MS);
    await ann.waitFor((state) => playerIn(state, catId)?.takenOver === true, 'the takeover');
    await until(() => agent.questions.length === 1, 'the first question');
    await settle();
    expect(truth(code).phase).toBe('clue');
    // The clock moves the game nowhere: the driver asks again, and the clue comes.
    server.advance(RETRY_MS);
    await until(() => agent.questions.length === 2, 'the second question');
    server.advance(CLUE_PACE_MS);
    await until(() => truth(code).phase === 'guess', 'the clue');
    expect(truth(code).history.at(-1)).toMatchObject({ word: 'zebra', captain: catId });
  });

  test('lets go of someone offline while the agent is down, and takes them over again once it is back', async () => {
    const { ann, cat, code } = await people(['Dan'], NO_TIMERS);
    const catId = await goes(cat, ann);
    agent.up = false;
    server.advance(TAKEOVER_MS);
    // The request for Cat finds the agent gone: nobody is played for any more.
    await until(() => server.logs.some(({ event }) => event === 'agent_down'), 'the agent down');
    await settle();
    expect(playerIn(ann.state, catId)?.takenOver).toBeUndefined();
    expect(agent.questions).toHaveLength(1);
    // Back, the agent plays for Cat again, without anyone in the room doing a thing.
    agent.up = true;
    server.advance(PING_MS);
    await ann.waitFor((state) => playerIn(state, catId)?.takenOver === true, 'taken over again');
    await until(() => agent.questions.filter((request) => request.kind === 'clue').length === 2, 'the question');
    server.advance(CLUE_PACE_MS);
    await until(() => truth(code).phase === 'guess', 'the clue');
  });
});

describe('a game that an AI played in', () => {
  const kept = () =>
    server.db.prepare('SELECT log, agent_log AS agentLog FROM replays').all() as {
      log: string;
      agentLog: string | null;
    }[];

  test('brings nobody points, a streak or a friend title, and is kept with the AI log beside its own', async () => {
    // The AI student reveals Reviewer 2 at once, which ends the game.
    agent.play = (request) => {
      if (request.kind === 'clue') return scriptedPlay(request);
      const cards = (server.app.rooms.all()[0]?.data as KeywordsData).game?.cards ?? [];
      const reviewer2 = cards.findIndex((card) => card.color === 'reviewer2');
      return { ok: true, kind: 'guess', picks: [reviewer2], reason: 'A hunch.', note: SCRIPT_NOTE };
    };
    const { browser, ann, code } = await againstAi();
    const reviewer2 = truth(code).cards.findIndex((card) => card.color === 'reviewer2');
    const reds = redTargets(code);
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
    const [row] = kept();
    const log = JSON.parse(row?.log ?? '{}') as { agents: Record<string, string> };
    expect(Object.values(log.agents)).toEqual(['reviewer1', 'reviewer1']);
    const agentLog = JSON.parse(row?.agentLog ?? '{}') as { steps: { kind: string; answer: unknown }[] };
    expect(agentLog.steps.map(({ kind, answer }) => ({ kind, answer }))).toEqual([
      { kind: 'clue', answer: { word: 'zebra', count: 2, targets: reds } },
      { kind: 'guess', answer: { picks: [reviewer2], reason: 'A hunch.' } },
    ]);
    // Ann deletes her account: the record stays, the AI's log with it, and says no longer who she was.
    expect((await browser.request('/api/account/delete', { password: 'correct horse' })).body).toEqual({ ok: true });
    expect(server.db.prepare('SELECT count(*) AS n FROM game_players').get()).toEqual({ n: 0 });
    expect(kept()).toEqual([row]);
  });

  test('counts one that an AI played in for someone offline, whose moves the logs mark', async () => {
    const { ann, cat, reds, code } = await people(['Dan']);
    const [dan] = reds as [TestClient];
    const catId = await goes(cat, ann);
    server.advance(TAKEOVER_MS);
    await ann.waitFor((state) => playerIn(state, catId)?.takenOver === true, 'the takeover');
    server.advance(CLUE_PACE_MS);
    await until(() => truth(code).phase === 'guess', 'the clue');
    // Dan reveals Reviewer 2, which ends the game, and the blue group wins.
    const game = truth(code);
    const reviewer2 = game.cards.findIndex((card) => card.color === 'reviewer2');
    await expectOk(dan.send('keywords:reveal', { gameId: game.gameId, turn: game.turn, card: reviewer2 }));
    await ann.waitFor((state) => state.phase === 'ended', 'the end');
    const account = server.accounts.byName('Ann');
    expect(
      server.db.prepare('SELECT points, won, agents FROM game_records WHERE account_id = ?').all(account?.id ?? 0),
    ).toEqual([{ points: 0, won: 1, agents: 1 }]);
    expect(server.db.prepare('SELECT * FROM streaks').all()).toEqual([]);
    const [row] = kept();
    const log = JSON.parse(row?.log ?? '{}') as GameLogData;
    expect(log.agents).toBeUndefined();
    // The red clue was Cat's seat's, given by the AI; Dan's reveal was his own.
    expect(log.entries.filter(({ type }) => type === 'keywords:clue').at(-1)).toMatchObject({
      by: catId,
      agent: 'reviewer1',
      data: { word: 'zebra' },
    });
    expect(log.entries.find(({ type }) => type === 'keywords:reveal')).not.toHaveProperty('agent');
    const agentLog = JSON.parse(row?.agentLog ?? '{}') as { steps: object[] };
    expect(agentLog.steps).toEqual([
      expect.objectContaining({ by: catId, persona: 'reviewer1', takeover: true, kind: 'clue', t: expect.any(Number) }),
    ]);
  });
});
