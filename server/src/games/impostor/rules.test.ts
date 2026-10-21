import { roleCounts, survivors } from '@reviewer2/shared/impostor';
import { describe, expect, it } from 'vitest';
import { seededRng } from '../../core/random';
import * as rules from './rules';
import {
  accepted,
  APPLE,
  at,
  cast,
  dealt,
  describeAll,
  LINES,
  PEAR,
  playRound,
  refused,
  SETTINGS,
  voteAll,
} from './testing';

const write = (game: ReturnType<typeof dealt>, id: string, text: string, now = 0) =>
  rules.describe(game, id, { ...at(game), text }, now);

describe('dealing', () => {
  it('gives the roles as the number of players asks', () => {
    expect(roleCounts(4, true)).toEqual({ reviewer2: 1, pi: 0 });
    expect(roleCounts(5, true)).toEqual({ reviewer2: 1, pi: 0 });
    expect(roleCounts(6, true)).toEqual({ reviewer2: 1, pi: 1 });
    expect(roleCounts(8, true)).toEqual({ reviewer2: 1, pi: 1 });
    expect(roleCounts(9, true)).toEqual({ reviewer2: 2, pi: 1 });
    expect(roleCounts(12, true)).toEqual({ reviewer2: 2, pi: 1 });
    expect(roleCounts(9, false)).toEqual({ reviewer2: 2, pi: 0 });
    expect(survivors(6)).toBe(2);
    expect(survivors(7)).toBe(3);
  });

  it('deals numbers and roles at random, and one word to each side', () => {
    const players = Array.from({ length: 9 }, (_, index) => ({ id: `p${index}`, agent: false }));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = rules.newGame(
        {
          gameId: 'g',
          settings: SETTINGS,
          players,
          words: [APPLE, PEAR],
          source: (student) => ({ kind: 'setter', setter: 'x', field: 'general', named: student === APPLE }),
        },
        seededRng(seed),
        0,
      );
      expect(game.players.map((player) => player.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const roles = game.players.map((player) => player.role);
      expect(roles.filter((role) => role === 'reviewer2')).toHaveLength(2);
      expect(roles.filter((role) => role === 'pi')).toHaveLength(1);
      expect([game.words.student, game.words.reviewer2].sort((a, b) => a.word.localeCompare(b.word))).toEqual([
        APPLE,
        PEAR,
      ]);
      expect(game.source).toMatchObject({ named: game.words.student === APPLE });
      expect(game.speaker).toBe(game.players[0]?.id);
      seen.add(`${game.players.find((player) => player.role === 'reviewer2')?.id}:${game.words.student.word}`);
    }
    expect(seen.size).toBeGreaterThan(4);
  });
});

describe('describing', () => {
  it('goes by number, one line each, and then to the vote', () => {
    let game = dealt('SSSR');
    expect(refused(write(game, 'p2', 'a fruit'))).toBe('not_speaker');
    game = accepted(write(game, 'p1', 'grows on a tree'));
    expect(game.speaker).toBe('p2');
    game = describeAll(game);
    expect(game.phase).toBe('vote');
    expect(game.lines.map((line) => line.by)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(refused(write(game, 'p1', 'one more'))).toBe('wrong_phase');
  });

  it('stops a line that gives the writer’s word away, or repeats one', () => {
    let game = dealt('SRSS');
    expect(refused(write(game, 'p1', 'an Apple a day'))).toBe('line_has_word');
    expect(refused(write(game, 'p1', 'two apples'))).toBe('line_has_word');
    expect(refused(write(game, 'p1', '   '))).toBe('line_empty');
    expect(refused(write(game, 'p1', 'x'.repeat(SETTINGS.length + 1)))).toBe('line_too_long');
    expect(refused(rules.describe(game, 'p1', { gameId: 'g1', round: 2, text: 'a fruit' }, 0))).toBe('stale');
    expect(refused(rules.describe(game, 'p1', { gameId: 'old', round: 1, text: 'a fruit' }, 0))).toBe('stale');
    game = accepted(write(game, 'p1', 'grows on a tree'));
    // The other word is the Reviewer 2's own to keep out of their line, not the students'.
    expect(refused(write(game, 'p2', 'like a pear'))).toBe('line_has_word');
    expect(refused(write(game, 'p2', 'Grows on a tree!'))).toBe('line_repeated');
    expect(refused(write(game, 'p2', 'grows on a trees'))).toBe('line_repeated');
    game = accepted(write(game, 'p2', 'an apple is near it'));
    expect(game.lines[1]?.text).toBe('an apple is near it');
  });

  it('lets the PI say anything but a line before', () => {
    let game = dealt('PSSSSR');
    game = accepted(write(game, 'p1', 'an apple or a pear'));
    expect(game.speaker).toBe('p2');
  });

  it('misses the line of a player whose time runs out', () => {
    let game = dealt('SSSR', { describeTime: 60 }, 0);
    expect(game.clock).toEqual({ ends: 60_000, length: 60_000 });
    expect(rules.deadlineOf(game)).toBe(60_000);
    expect(rules.expire(game, 59_999)).toBe(game);
    game = rules.expire(game, 60_000);
    expect(game.lines).toEqual([{ round: 1, by: 'p1', text: null, tie: false }]);
    expect(game.speaker).toBe('p2');
    expect(game.clock).toEqual({ ends: 120_000, length: 60_000 });
  });
});

describe('voting', () => {
  it('reveals the votes together, once everyone has voted', () => {
    let game = describeAll(dealt('SSSSR'));
    expect(refused(rules.vote(game, 'p1', { ...at(game), number: 1 }, 0))).toBe('bad_vote');
    expect(refused(rules.vote(game, 'p1', { ...at(game), number: 9 }, 0))).toBe('bad_vote');
    game = accepted(rules.vote(game, 'p1', { ...at(game), number: 5 }, 0));
    expect(refused(rules.vote(game, 'p1', { ...at(game), number: 2 }, 0))).toBe('voted_already');
    game = cast(game, { p2: 5, p3: 1, p4: null });
    expect(game.ballots).toEqual([]);
    expect(game.pending).toEqual({ p1: 'p5', p2: 'p5', p3: 'p1', p4: null });
    game = cast(game, { p5: 1 });
    expect(game.ballots).toEqual([
      {
        round: 1,
        ballot: 'vote',
        votes: { p1: 'p5', p2: 'p5', p3: 'p1', p4: null, p5: 'p1' },
        out: null,
        tied: ['p1', 'p5'],
      },
    ]);
    expect(game).toMatchObject({ phase: 'tie', tied: ['p1', 'p5'], pending: {} });
  });

  it('puts a single leader out, and the game goes on', () => {
    let game = playRound(dealt('SSSSR'), { p1: 2, p2: 1, p3: 2, p4: 2, p5: 2 });
    expect(game.ballots).toEqual([
      { round: 1, ballot: 'vote', votes: { p1: 'p2', p2: 'p1', p3: 'p2', p4: 'p2', p5: 'p2' }, out: 'p2', tied: [] },
    ]);
    expect(game.players[1]).toMatchObject({ fate: 'voted_out', out: 1 });
    expect(game).toMatchObject({ phase: 'describe', round: 2, speaker: 'p1' });
    game = describeAll(game);
    expect(game.lines.filter((line) => line.round === 2).map((line) => line.by)).toEqual(['p1', 'p3', 'p4', 'p5']);
  });

  it('counts abstentions and votes whose time ran out apart, and puts nobody out for no votes', () => {
    let game = describeAll(dealt('SSSR', { voteTime: 30 }, 0), 0);
    game = accepted(rules.vote(game, 'p1', { ...at(game), number: null }, 0));
    game = rules.expire(game, 30_000);
    expect(game.ballots[0]).toEqual({
      round: 1,
      ballot: 'vote',
      votes: { p1: null, p2: 'timeout', p3: 'timeout', p4: 'timeout' },
      out: null,
      tied: [],
    });
    expect(game).toMatchObject({ round: 2, phase: 'describe' });
    expect(game.players.every((player) => player.fate === 'alive')).toBe(true);
  });

  it('has the tied add a line each and the others vote again among them, once', () => {
    let game = playRound(dealt('SSSSR'), { p1: 2, p2: 1, p3: 1, p4: 2, p5: null });
    expect(game).toMatchObject({ phase: 'tie', tied: ['p1', 'p2'], speaker: 'p1' });
    expect(refused(rules.vote(game, 'p3', { ...at(game), number: 1 }, 0))).toBe('wrong_phase');
    game = describeAll(game);
    expect(game.lines.filter((line) => line.tie).map((line) => line.by)).toEqual(['p1', 'p2']);
    expect(game.phase).toBe('revote');
    expect(refused(rules.vote(game, 'p1', { ...at(game), number: 2 }, 0))).toBe('not_playing');
    expect(refused(rules.vote(game, 'p3', { ...at(game), number: 4 }, 0))).toBe('bad_vote');
    game = voteAll(game, { p3: 1, p4: 2, p5: null });
    expect(game.ballots[1]).toMatchObject({ ballot: 'revote', votes: { p3: 'p1', p4: 'p2', p5: null }, out: null });
    expect(game).toMatchObject({ phase: 'describe', round: 2 });
  });

  it('puts the leader of a revote out', () => {
    let game = playRound(dealt('SSSSR'), { p1: 5, p2: 5, p3: 1, p4: 1, p5: null });
    game = describeAll(game);
    game = voteAll(game, { p2: 5, p3: 5, p4: 5 });
    expect(game.ballots[1]).toMatchObject({ ballot: 'revote', out: 'p5' });
    expect(game.result).toEqual({ winner: 'student', reason: 'caught' });
  });
});

describe('the end', () => {
  it('lets a Reviewer 2 win by lasting until few are left', () => {
    let game = playRound(dealt('RSSS'), { p1: 2, p2: 3, p3: 2, p4: 2 });
    expect(game.phase).toBe('describe');
    game = playRound(game, { p1: 3, p3: 4, p4: 3 });
    expect(game.result).toEqual({ winner: 'reviewer2', reason: 'survived' });
    expect(game).toMatchObject({ phase: 'over', speaker: null, clock: null });
  });

  it('lets the PI win when the Reviewer 2s are out and the PI is not', () => {
    const game = playRound(dealt('RPSSSS'), { p1: 3, p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 });
    expect(game.result).toEqual({ winner: 'pi', reason: 'pi_survived' });
  });

  it('lets the students win once the Reviewer 2s and the PI are out', () => {
    let game = playRound(dealt('RPSSSS'), { p1: 3, p2: 3, p3: 2, p4: 2, p5: 2, p6: 2 });
    expect(game.result).toBeNull();
    game = playRound(game, { p1: 3, p3: 1, p4: 1, p5: 1, p6: 1 });
    expect(game.result).toEqual({ winner: 'student', reason: 'caught' });
  });

  it('goes on, round after round, while everyone abstains', () => {
    let game = dealt('SSSR');
    for (let round = 0; round < 6; round += 1) game = playRound(game, {});
    expect(game).toMatchObject({ phase: 'describe', round: 7 });
  });
});

describe('the comeback', () => {
  const settings = { comeback: true, describeTime: 60, voteTime: 30 };

  it('lets a Reviewer 2 who was voted out win with the students’ word', () => {
    let game = playRound(dealt('RPSSSS', settings), { p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 });
    expect(game).toMatchObject({ phase: 'comeback', comeback: 'p1', clock: { ends: 30_000, length: 30_000 } });
    expect(refused(rules.guess(game, 'p2', { gameId: 'g1', word: 'apple' }, 0))).toBe('no_comeback');
    game = accepted(rules.guess(game, 'p1', { gameId: 'g1', word: ' Apples ' }, 0));
    expect(game.guesses).toEqual([{ by: 'p1', word: 'Apples', correct: true }]);
    expect(game.result).toEqual({ winner: 'reviewer2', reason: 'comeback' });
  });

  it('goes on after a wrong guess, or none in time', () => {
    let game = playRound(dealt('RPSSSS', settings), { p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 });
    game = accepted(rules.guess(game, 'p1', { gameId: 'g1', word: 'pear' }, 0));
    expect(game.result).toEqual({ winner: 'pi', reason: 'pi_survived' });
    game = playRound(dealt('PRSSSS', settings), { p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 });
    expect(game.comeback).toBe('p1');
    game = rules.expire(game, 30_000);
    expect(game.guesses).toEqual([{ by: 'p1', word: null, correct: false }]);
    expect(game).toMatchObject({ phase: 'describe', round: 2, comeback: null });
  });

  it('isn’t there for a student, or when the room leaves it out', () => {
    expect(playRound(dealt('RPSSSS', settings), { p1: 3, p2: 3, p4: 3, p5: 3, p6: 3 }).phase).toBe('describe');
    expect(playRound(dealt('RPSSSS'), { p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 }).result?.winner).toBe('pi');
  });
});

describe('reports', () => {
  const reason = 'said the word in a code';

  it('stops the clock while everyone else judges, and puts the player out when most agree', () => {
    let game = accepted(write(dealt('SSSSR', { describeTime: 60 }, 0), 'p1', 'grows on a tree', 0));
    game = accepted(rules.report(game, 'p3', { ...at(game), number: 1, line: 0, reason }, 10_000));
    expect(game.report).toMatchObject({ by: 'p3', target: 'p1', line: 0, eligible: ['p2', 'p3', 'p4', 'p5'] });
    expect(game.paused).toEqual({ left: 50_000, length: 60_000 });
    expect(game.clock).toBeNull();
    expect(rules.deadlineOf(game)).toBe(30_000);
    expect(refused(write(game, 'p2', 'sweet and crisp', 10_000))).toBe('report_open');
    expect(refused(rules.report(game, 'p4', { ...at(game), number: 1, line: null, reason }, 10_000))).toBe(
      'report_open',
    );
    expect(refused(rules.judge(game, 'p1', { gameId: 'g1', verdict: 'disagree' }, 10_000))).toBe('cannot_judge');
    game = accepted(rules.judge(game, 'p2', { gameId: 'g1', verdict: 'agree' }, 11_000));
    expect(refused(rules.judge(game, 'p2', { gameId: 'g1', verdict: 'agree' }, 11_000))).toBe('judged_already');
    game = accepted(rules.judge(game, 'p3', { gameId: 'g1', verdict: 'agree' }, 11_000));
    game = accepted(rules.judge(game, 'p4', { gameId: 'g1', verdict: 'disagree' }, 11_000));
    expect(game.report).not.toBeNull();
    game = accepted(rules.judge(game, 'p5', { gameId: 'g1', verdict: 'agree' }, 12_000));
    expect(game.report).toBeNull();
    expect(game.reports[0]).toMatchObject({ passed: true, verdicts: { p2: 'agree', p5: 'agree', p4: 'disagree' } });
    expect(game.players[0]).toMatchObject({ fate: 'violation', out: 1 });
    // The clock of the player describing goes on from where it stood.
    expect(game).toMatchObject({ speaker: 'p2', clock: { ends: 62_000, length: 60_000 } });
  });

  it('needs more than half of those who may judge to agree, and costs the reporter when it fails', () => {
    let game = dealt('SSSSR', { describeTime: 60 }, 0);
    game = accepted(rules.report(game, 'p3', { ...at(game), number: 1, line: null, reason }, 10_000));
    game = accepted(rules.judge(game, 'p2', { gameId: 'g1', verdict: 'agree' }, 10_000));
    game = accepted(rules.judge(game, 'p3', { gameId: 'g1', verdict: 'agree' }, 10_000));
    game = rules.expire(game, 30_000);
    expect(game.reports[0]).toMatchObject({
      passed: false,
      verdicts: { p2: 'agree', p3: 'agree', p4: 'abstain', p5: 'abstain' },
    });
    expect(game.players[0]?.fate).toBe('alive');
    expect(game).toMatchObject({ speaker: 'p1', clock: { ends: 80_000 } });
    expect(refused(rules.report(game, 'p3', { ...at(game), number: 2, line: null, reason }, 30_000))).toBe(
      'reported_already',
    );
  });

  it('takes a reason that gives nothing away, and a line of the reported player’s', () => {
    let game = accepted(write(dealt('SSSSR'), 'p1', 'grows on a tree'));
    const send = (by: string, number: number, line: number | null, text = reason) =>
      refused(rules.report(game, by, { ...at(game), number, line, reason: text }, 0));
    expect(send('p3', 3, null)).toBe('bad_report');
    expect(send('p3', 7, null)).toBe('bad_report');
    expect(send('p3', 2, 0)).toBe('bad_report');
    expect(send('p3', 1, 3)).toBe('bad_report');
    expect(send('p3', 1, null, 'they said apple')).toBe('line_has_word');
    expect(send('p3', 1, null, '  ')).toBe('line_empty');
    expect(send('p3', 1, null, 'x'.repeat(61))).toBe('line_too_long');
    game = playRound(game, { p1: 5, p2: 5, p3: 5, p4: 5, p5: 1 });
    expect(game.result?.winner).toBe('student');
    expect(send('p3', 1, null)).toBe('game_over');
  });

  it('starts the vote again, without the player, when one passes during a vote', () => {
    let game = describeAll(dealt('SSSSSPR'));
    game = accepted(rules.vote(game, 'p1', { ...at(game), number: 3 }, 0));
    game = accepted(rules.report(game, 'p2', { ...at(game), number: 3, line: 2, reason }, 0));
    for (const id of ['p1', 'p2', 'p4', 'p5']) {
      game = accepted(rules.judge(game, id, { gameId: 'g1', verdict: 'agree' }, 0));
    }
    expect(game.report).not.toBeNull();
    game = accepted(rules.judge(game, 'p6', { gameId: 'g1', verdict: 'abstain' }, 0));
    game = accepted(rules.judge(game, 'p7', { gameId: 'g1', verdict: 'disagree' }, 0));
    expect(game.players[2]?.fate).toBe('violation');
    expect(game).toMatchObject({ phase: 'vote', pending: {}, round: 1 });
    expect(rules.votersOf(game).map((player) => player.id)).toEqual(['p1', 'p2', 'p4', 'p5', 'p6', 'p7']);
  });

  it('passes over the reported player who was describing', () => {
    let game = accepted(write(dealt('SSSSR', { describeTime: 60 }, 0), 'p1', 'grows on a tree', 0));
    game = accepted(rules.report(game, 'p1', { ...at(game), number: 2, line: null, reason }, 5_000));
    for (const id of ['p1', 'p3', 'p4'])
      game = accepted(rules.judge(game, id, { gameId: 'g1', verdict: 'agree' }, 6_000));
    expect(game.report).not.toBeNull();
    game = accepted(rules.judge(game, 'p5', { gameId: 'g1', verdict: 'disagree' }, 6_000));
    expect(game).toMatchObject({ speaker: 'p3', clock: { ends: 66_000 } });
  });

  it('isn’t open while a Reviewer 2 guesses the word', () => {
    const game = playRound(dealt('RPSSSS', { comeback: true }), { p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 });
    expect(refused(rules.report(game, 'p2', { ...at(game), number: 3, line: null, reason }, 0))).toBe('wrong_phase');
  });
});

describe('leaving', () => {
  it('ends the game with no winner when a Reviewer 2 in it leaves', () => {
    const game = rules.leave(dealt('SSSSR'), 'p5', true, 0);
    expect(game).toMatchObject({ phase: 'over', result: { winner: null, reason: 'reviewer2_left' }, removed: true });
    expect(game.players[4]).toMatchObject({ fate: 'left', out: 1 });
  });

  it('goes on without anyone else, as if their turn were done', () => {
    let game = dealt('SSSSSR');
    game = rules.leave(game, 'p1', false, 0);
    expect(game.players[0]).toMatchObject({ fate: 'left', out: 1 });
    expect(game).toMatchObject({ speaker: 'p2', removed: false });
    game = cast(describeAll(game), { p2: 6, p3: 6, p4: 6, p5: 6 });
    expect(game.phase).toBe('vote');
    game = rules.leave(game, 'p6', false, 0);
    // The Reviewer 2 left before the votes were revealed: nobody wins.
    expect(game.result).toEqual({ winner: null, reason: 'reviewer2_left' });
  });

  it('reveals the votes when the last one who hadn’t voted leaves', () => {
    let game = cast(describeAll(dealt('SSSSSR')), { p1: 6, p2: 6, p3: 6, p4: 6, p6: 1 });
    game = rules.leave(game, 'p5', false, 0);
    expect(game.ballots[0]?.votes).toEqual({ p1: 'p6', p2: 'p6', p3: 'p6', p4: 'p6', p6: 'p1' });
    expect(game.result?.winner).toBe('student');
  });

  it('drops a report of the player who leaves, and settles one they were to judge', () => {
    let game = dealt('SSSSSR', { describeTime: 60 }, 0);
    game = accepted(rules.report(game, 'p2', { ...at(game), number: 3, line: null, reason: 'odd' }, 10_000));
    game = rules.leave(game, 'p3', false, 12_000);
    expect(game).toMatchObject({ report: null, reports: [], clock: { ends: 62_000 } });
    game = accepted(rules.report(game, 'p2', { ...at(game), number: 4, line: null, reason: 'odd' }, 12_000));
    game = accepted(rules.judge(game, 'p1', { gameId: 'g1', verdict: 'agree' }, 12_000));
    game = accepted(rules.judge(game, 'p2', { gameId: 'g1', verdict: 'agree' }, 12_000));
    game = accepted(rules.judge(game, 'p6', { gameId: 'g1', verdict: 'disagree' }, 12_000));
    game = rules.leave(game, 'p5', false, 13_000);
    expect(game.report).toBeNull();
    expect(game.reports[0]).toMatchObject({
      target: 'p4',
      passed: false,
      verdicts: { p1: 'agree', p2: 'agree', p5: 'abstain', p6: 'disagree' },
    });
    expect(game.players[3]?.fate).toBe('alive');
  });

  it('counts a player who leaves out, and the game ends if few are left', () => {
    let game = playRound(dealt('RSSS'), { p1: 2, p2: 3, p3: 2, p4: 2 });
    game = rules.leave(game, 'p3', false, 0);
    expect(game.result).toEqual({ winner: 'reviewer2', reason: 'survived' });
  });

  it('makes no guess for a Reviewer 2 who leaves while guessing', () => {
    let game = playRound(dealt('RPSSSS', { comeback: true }), { p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 });
    game = rules.leave(game, 'p1', false, 0);
    expect(game.guesses).toEqual([{ by: 'p1', word: null, correct: false }]);
    expect(game.result?.winner).toBe('pi');
  });

  it('starts the next round when a tied player leaves before the revote', () => {
    let game = playRound(dealt('SSSSR'), { p1: 2, p2: 1, p3: 1, p4: 2, p5: null });
    game = describeAll(game);
    expect(game.phase).toBe('revote');
    game = rules.leave(game, 'p1', false, 0);
    expect(game).toMatchObject({ phase: 'describe', round: 2, tied: [] });
  });
});

describe('talking off the field', () => {
  it('is for those who are out, watch or set the words, and names neither word', () => {
    const game = dealt('SSSSR');
    expect(refused(rules.talk(game, 'p1', { gameId: 'g1', text: 'hello' }, false))).toBe('cannot_talk');
    expect(refused(rules.talk(game, 'w', { gameId: 'g1', text: 'pears!' }, true))).toBe('chat_has_word');
    expect(refused(rules.talk(game, 'w', { gameId: 'g1', text: 'Apple' }, true))).toBe('chat_has_word');
    expect(refused(rules.talk(game, 'w', { gameId: 'g2', text: 'hello' }, true))).toBe('stale');
    const next = accepted(rules.talk(game, 'w', { gameId: 'g1', text: ' pineapple? ' }, true));
    expect(next.talk).toEqual([{ by: 'w', text: 'pineapple?', after: false }]);
  });

  it('is for everyone after the game', () => {
    const game = playRound(dealt('SSSSR'), { p1: 5, p2: 5, p3: 5, p4: 5, p5: 1 });
    const next = accepted(rules.talk(game, 'p1', { gameId: 'g1', text: 'well played' }, false));
    expect(next.talk).toEqual([{ by: 'p1', text: 'well played', after: true }]);
  });
});

describe('guessing the AI players', () => {
  const withAgents = (agents: string[]) => {
    const game = playRound(dealt('SSSSR'), { p1: 5, p2: 5, p3: 5, p4: 5, p5: 1 });
    return { ...game, players: game.players.map((player) => ({ ...player, agent: agents.includes(player.id) })) };
  };

  it('is open after an anonymous game with AI players and at least 3 people', () => {
    expect(rules.agentGuessOpen(withAgents(['p4', 'p5']))).toBe(true);
    expect(rules.agentGuessOpen(withAgents(['p3', 'p4', 'p5']))).toBe(false);
    expect(rules.agentGuessOpen(withAgents([]))).toBe(false);
    const named = withAgents(['p5']);
    expect(rules.agentGuessOpen({ ...named, settings: { ...named.settings, anonymous: false } })).toBe(false);
    expect(rules.agentGuessOpen({ ...named, phase: 'vote' })).toBe(false);
  });

  it('takes up to as many numbers as there were AI players, once, or a skip', () => {
    const game = withAgents(['p4', 'p5']);
    expect(refused(rules.guessAgents(game, 'p5', [1]))).toBe('cannot_guess');
    expect(refused(rules.guessAgents(game, 'x', [1]))).toBe('cannot_guess');
    expect(refused(rules.guessAgents(game, 'p1', [1, 2, 3]))).toBe('bad_request');
    expect(refused(rules.guessAgents(game, 'p1', []))).toBe('bad_request');
    expect(refused(rules.guessAgents(game, 'p1', [2, 2]))).toBe('bad_request');
    expect(refused(rules.guessAgents(game, 'p1', [6]))).toBe('bad_request');
    expect(refused(rules.guessAgents(game, 'p1', ['4']))).toBe('bad_request');
    const made = rules.guessAgents(game, 'p1', [5, 2]);
    expect(made).toMatchObject({ ok: true, guess: [2, 5] });
    const next = accepted(made);
    expect(next.agentGuesses).toEqual({ p1: [2, 5] });
    expect(refused(rules.guessAgents(next, 'p1', null))).toBe('cannot_guess');
    expect(accepted(rules.guessAgents(next, 'p2', null)).agentGuesses).toEqual({ p1: [2, 5], p2: null });
  });
});

it('keeps lines that are apart', () => {
  expect(new Set(LINES).size).toBe(LINES.length);
});
