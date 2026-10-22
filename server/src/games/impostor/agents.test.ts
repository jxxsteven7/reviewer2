import type { AgentAnswer } from '@reviewer2/shared';
import { AGENT_REQUEST } from '@reviewer2/shared/schemas';
import { describe, expect, it } from 'vitest';
import type { GameContext } from '../../core/game';
import { seededRng } from '../../core/random';
import { agentMove, agentTask, DESCRIBE_PACE_MS, HISTORY_BYTES, practiceSeats, VOTE_PACE_MS } from './agents';
import { impostorGame } from './index';
import * as rules from './rules';
import type { ImpostorData, ImpostorGame } from './state';
import { accepted, at, dealt, describeAll, playRound, SETTINGS } from './testing';

// What the AI players are asked to do, and the messages their answers make.

const NOTE = { model: 'script', prompt: 'impostor-1', ms: 1 };

const context = (agents: readonly string[]): GameContext => ({
  phase: 'playing',
  language: 'en',
  rng: seededRng(1),
  chairId: 'p1',
  public: false,
  now: () => 0,
  keyOf: (id) => `key-${id}`,
  isOnline: () => true,
  agentOf: (id) => (agents.includes(id) ? 'reviewer1' : null),
  playerIds: () => [],
  hasAccount: () => false,
  hasField: () => true,
  customAuthor: () => null,
  titleCount: () => null,
  awardsTitles: () => false,
});

const dataOf = (game: ImpostorGame, agents: readonly string[]): ImpostorData => ({
  settings: game.settings,
  seats: game.players.map((player) => player.id),
  setterWords: null,
  game: { ...game, players: game.players.map((player) => ({ ...player, agent: agents.includes(player.id) })) },
});

describe('the AI players', () => {
  it('fill a practice room of six around its creator', () => {
    expect(practiceSeats('player')).toEqual({
      seat: { type: 'impostor:seat', payload: { play: true } },
      agents: [null, null, null, null, null],
    });
    expect(practiceSeats('captain')).toBeNull();
  });

  it('describe in their turn, knowing their own number and word and what everyone has seen', () => {
    const agents = ['p1', 'p3'];
    let game = dealt('SSSR');
    const data = dataOf(game, agents);
    const task = agentTask(data, context(agents), 'p1');
    expect(task).toMatchObject({ kind: 'describe', moment: 'g1:1:describe:p1', advice: false });
    expect(task?.pace).toEqual({ first: DESCRIBE_PACE_MS, step: 0 });
    expect(task?.question).toMatchObject({
      kind: 'describe',
      tie: false,
      game: 'impostor',
      number: 1,
      word: { word: 'apple', forms: ['apples'] },
      round: 1,
      lines: [],
      seats: [1, 2, 3, 4].map((number) => ({ number, fate: 'alive', role: null })),
    });
    expect(agentTask(data, context(agents), 'p3')).toBeNull();
    expect(agentTask(data, context([]), 'p1')).toBeNull();
    const move = agentMove(data, task!, { ok: true, kind: 'describe', text: 'grows on a tree', note: NOTE }, []);
    expect(move).toEqual({ type: 'impostor:describe', payload: { gameId: 'g1', round: 1, text: 'grows on a tree' } });
    game = accepted(rules.describe(game, 'p1', { ...at(game), text: 'grows on a tree' }, 0));
    expect(agentTask(dataOf(game, agents), context(agents), 'p1')).toBeNull();
    // A Reviewer 2 who is an AI player has the other word, and doesn't know it is one.
    const r2 = agentTask(dataOf(dealt('RSSS'), ['p1']), context(['p1']), 'p1');
    expect(r2?.question).toMatchObject({
      word: { word: 'pear' },
      seats: expect.arrayContaining([{ number: 1, fate: 'alive', role: null }]),
    });
  });

  // Each of the 144 long lines is checked against every line before it, which takes a few seconds,
  // more than the default allows on a slow machine.
  it('are told as many whole rounds of a long game as fit in a request', { timeout: 30_000 }, () => {
    // Twelve players, lines as long as a room allows, and round after round in which nobody is
    // voted out: the history outgrows the request's share.
    let game = dealt('RSSSSSSSSSSS', { length: 500 });
    const rng = seededRng(7);
    const filler = () => Array.from({ length: 480 }, () => String.fromCharCode(97 + rng.int(26))).join('');
    for (let round = 1; round <= 12; round += 1) {
      for (let number = 1; number <= 12; number += 1) {
        game = accepted(rules.describe(game, `p${number}`, { ...at(game), text: filler() }, 0));
      }
      game = rules.expire({ ...game, clock: { ends: 0, length: 1 } }, 0);
    }
    expect(game.round).toBe(13);
    const task = agentTask(dataOf(game, ['p1']), context(['p1']), 'p1');
    const question = task?.question as { lines: { round: number }[]; ballots: { round: number }[] };
    expect(Buffer.byteLength(JSON.stringify(question))).toBeLessThanOrEqual(HISTORY_BYTES + 1024);
    const rounds = new Set(question.lines.map((line) => line.round));
    expect(rounds.size).toBeGreaterThan(1);
    expect(rounds.size).toBeLessThan(12);
    expect(Math.max(...rounds)).toBe(12);
    expect(Math.min(...question.ballots.map((ballot) => ballot.round))).toBe(Math.min(...rounds));
    // A report of a line of a round the agent isn't told carries the line itself.
    const first = game.lines[0] as { by: string; text: string };
    const reported = accepted(rules.report(game, 'p2', { ...at(game), number: 1, line: 0, reason: 'odd' }, 0));
    const judging = agentTask(dataOf(reported, ['p3']), context(['p3']), 'p3');
    expect(judging?.question).toMatchObject({ kind: 'judge', report: { by: 2, target: 1, text: first.text } });
    expect((judging?.question as { lines: { round: number }[] }).lines.some((line) => line.round === 1)).toBe(false);
  });

  it('are told a line of family emoji as the game took it, however many code points it is', () => {
    // The game counts what is seen, 60 by default in English: a line of 60 family emoji passes its
    // check and is 600 code points, which the request's schema counts.
    const family = String.fromCodePoint(
      0x1f9d1,
      0x1f3fb,
      0x200d,
      0x2764,
      0xfe0f,
      0x200d,
      0x1f48b,
      0x200d,
      0x1f9d1,
      0x1f3fc,
    );
    const game = accepted(rules.describe(dealt('SSSR'), 'p1', { ...at(dealt('SSSR')), text: family.repeat(60) }, 0));
    expect(game.lines[0]?.text).toHaveLength(900);
    const task = agentTask(dataOf(game, ['p2']), context(['p2']), 'p2');
    const request = { v: 1, persona: 'reviewer1', waitMs: 1, ...task?.question };
    expect(AGENT_REQUEST.safeParse(request)).toMatchObject({ success: true });
  });

  it('vote, each for its own seat, among those it may vote for', () => {
    const agents = ['p2', 'p4'];
    const game = describeAll(dealt('SSSR'));
    const data = dataOf(game, agents);
    const second = agentTask(data, context(agents), 'p2');
    const fourth = agentTask(data, context(agents), 'p4');
    expect(second).toMatchObject({ kind: 'vote', moment: 'g1:1:vote:0:p2', pace: { first: VOTE_PACE_MS, step: 0 } });
    expect(second?.question).toMatchObject({ kind: 'vote', candidates: [1, 3, 4] });
    expect(fourth?.question).toMatchObject({ kind: 'vote', candidates: [1, 2, 3], word: { word: 'pear' } });
    expect(second?.question).toMatchObject({ lines: [1, 2, 3, 4].map((number) => ({ round: 1, number, tie: false })) });
    const answer: AgentAnswer = { ok: true, kind: 'vote', number: 3, reason: 'vague', note: NOTE };
    expect(agentMove(data, second!, answer, [])).toEqual({
      type: 'impostor:vote',
      payload: { gameId: 'g1', round: 1, number: 3 },
    });
    expect(agentMove(data, second!, answer, ['impostor:vote'])).toBeNull();
    const after = accepted(rules.vote(game, 'p2', { ...at(game), number: 3 }, 0));
    expect(agentTask(dataOf(after, agents), context(agents), 'p2')).toBeNull();
    // In a revote, the tied don't vote, and the others only for one of them.
    const tie = describeAll(playRound(dealt('SSSSR'), { p1: 2, p2: 1, p3: 1, p4: 2, p5: null }));
    expect(agentTask(dataOf(tie, ['p1']), context(['p1']), 'p1')).toBeNull();
    expect(agentTask(dataOf(tie, ['p5']), context(['p5']), 'p5')?.question).toMatchObject({ candidates: [1, 2] });
  });

  it('judge a report, but not of themselves', () => {
    const agents = ['p2', 'p3'];
    let game = dealt('SSSSR');
    game = accepted(rules.report(game, 'p1', { ...at(game), number: 3, line: null, reason: 'too plain' }, 0));
    const data = dataOf(game, agents);
    const task = agentTask(data, context(agents), 'p2');
    expect(task).toMatchObject({ kind: 'judge', moment: 'g1:1:report:0:p2' });
    expect(task?.question).toMatchObject({
      kind: 'judge',
      report: { by: 1, target: 3, text: null, reason: 'too plain' },
    });
    expect(agentTask(data, context(agents), 'p3')).toBeNull();
    const move = agentMove(
      data,
      task!,
      { ok: true, kind: 'judge', verdict: 'disagree', reason: 'fine', note: NOTE },
      [],
    );
    expect(move).toEqual({ type: 'impostor:judge', payload: { gameId: 'g1', verdict: 'disagree' } });
    expect(agentMove(data, task!, { ok: true, kind: 'vote', number: 1, reason: '', note: NOTE }, [])).toBeNull();
  });

  it("guess the students' word once voted out, if the room allows it", () => {
    const game = playRound(dealt('RPSSSS', { comeback: true }), { p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 });
    const data = dataOf(game, ['p1']);
    const task = agentTask(data, context(['p1']), 'p1');
    expect(task).toMatchObject({ kind: 'comeback', moment: 'g1:1:comeback:p1' });
    expect(task?.question).toMatchObject({
      kind: 'comeback',
      word: { word: 'pear' },
      seats: expect.arrayContaining([{ number: 1, fate: 'voted_out', role: 'reviewer2' }]),
    });
    expect(agentMove(data, task!, { ok: true, kind: 'comeback', word: 'apple', note: NOTE }, [])).toEqual({
      type: 'impostor:comeback',
      payload: { gameId: 'g1', word: 'apple' },
    });
  });

  it('take a seat once a person has, up to twelve', () => {
    const ctx = { ...context(['a1']), phase: 'lobby' as const };
    const empty = impostorGame.create('en');
    expect(impostorGame.seatAgent?.(empty, ctx, 'a1', null)).toEqual({ ok: false, error: 'needs_human' });
    const seated = { ...empty, settings: SETTINGS, seats: ['p1'] };
    expect(impostorGame.seatAgent?.(seated, ctx, 'a1', null)).toMatchObject({
      ok: true,
      data: { seats: ['p1', 'a1'] },
    });
    const full = { ...seated, seats: ['p1', ...Array.from({ length: 11 }, (_, index) => `x${index}`)] };
    expect(impostorGame.seatAgent?.(full, ctx, 'a1', null)).toEqual({ ok: false, error: 'table_full' });
  });
});
