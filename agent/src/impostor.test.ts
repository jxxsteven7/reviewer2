import { MAX_AGENT_REASON } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { comeback, describe as describeWord, judge, vote } from './impostor';
import { PROMPT_VERSION } from './impostorPrompts';
import type { Turn } from './keywords';
import { ModelError } from './model';
import { PERSONAS } from './personas';
import { allowed, impostorRequest, ScriptedModel } from './testing';

const turn = (model: ScriptedModel, signal = AbortSignal.timeout(10_000)): Turn => ({
  model,
  persona: PERSONAS.reviewer1,
  signal,
  now: Date.now,
});

describe('a description', () => {
  test('is the first line that the rules of the room take', async () => {
    const model = new ScriptedModel({
      describe: [{ candidates: ['an apple a day', 'grows on a tree!', 'round and red', 'never asked for'] }],
    });
    const reply = allowed(await describeWord(impostorRequest('describe'), turn(model)));
    expect(reply).toMatchObject({ ok: true, kind: 'describe', text: 'round and red' });
    if (!reply.ok || reply.kind !== 'describe') throw new Error('no line');
    expect(reply.note).toMatchObject({ model: 'scripted', prompt: PROMPT_VERSION });
    expect(reply.note.candidates).toEqual([
      { text: 'an apple a day', problem: 'line_has_word' },
      { text: 'grows on a tree!', problem: 'line_repeated' },
      { text: 'round and red', problem: null },
    ]);
    expect(model.asked).toHaveLength(1);
  });

  test('asks twice more with the lines that were refused and why, and gives up after that', async () => {
    const refused = { candidates: ['apples', 'x'.repeat(61)] };
    const model = new ScriptedModel({ describe: [refused, refused, refused, { candidates: ['too late'] }] });
    const reply = allowed(await describeWord(impostorRequest('describe'), turn(model)));
    expect(reply).toMatchObject({ ok: false, error: 'no_legal_move' });
    expect(model.asked).toHaveLength(3);
    expect(model.asked[0]?.user).not.toContain('The rules refused');
    expect(model.asked[1]?.user).toContain('- "apples": it gives your word away');
    expect(model.asked[1]?.user).toContain('it is too long');
    if (reply.ok) throw new Error('a line');
    expect(reply.note?.candidates).toHaveLength(6);
  });

  test('notes the closest word and the fit of the lines that the model wrote first, from its last answer', async () => {
    const first = { closest: '  Pear \n tree ', fit: 'closest', candidates: ['apples'] };
    const second = { closest: 'p'.repeat(150), fit: 'mine', candidates: ['round and red'] };
    const model = new ScriptedModel({ describe: [first, second] });
    const reply = allowed(await describeWord(impostorRequest('describe'), turn(model)));
    if (!reply.ok || reply.kind !== 'describe') throw new Error('no line');
    expect(reply.note.judgment).toEqual({ closest: 'p'.repeat(100), fit: 'mine' });
    // A closest word that says nothing is no judgment, and leaves an earlier one in place.
    const blank = { closest: ' \n ', fit: 'mine', candidates: ['round and red'] };
    const kept = allowed(
      await describeWord(impostorRequest('describe'), turn(new ScriptedModel({ describe: [first, blank] }))),
    );
    if (!kept.ok || kept.kind !== 'describe') throw new Error('no line');
    expect(kept.note.judgment).toEqual({ closest: 'Pear tree', fit: 'closest' });
    // In the first round, the closest word alone; a fit that is none of the three is none.
    for (const fit of [{}, { fit: 'yes' }]) {
      const answer = { closest: 'pear', ...fit, candidates: ['round and red'] };
      const alone = allowed(
        await describeWord(impostorRequest('describe'), turn(new ScriptedModel({ describe: [answer] }))),
      );
      if (!alone.ok || alone.kind !== 'describe') throw new Error('no line');
      expect(alone.note.judgment).toEqual({ closest: 'pear' });
    }
    // A judgment that the model didn't write, or wrote nothing for, is none.
    for (const answer of [{ candidates: ['round and red'] }, { closest: '', candidates: ['round and red'] }]) {
      const none = allowed(
        await describeWord(impostorRequest('describe'), turn(new ScriptedModel({ describe: [answer] }))),
      );
      if (!none.ok || none.kind !== 'describe') throw new Error('no line');
      expect(none.note.judgment).toBeUndefined();
    }
  });

  test('of the PI, who has no word, can be anything that is not said yet', async () => {
    const model = new ScriptedModel({ describe: [{ candidates: ['an apple a day'] }] });
    const reply = allowed(await describeWord(impostorRequest('describe', { word: null }), turn(model)));
    expect(reply).toMatchObject({ ok: true, text: 'an apple a day' });
    expect(model.asked[0]?.system).toContain('You are the PI: you have no word.');
  });

  test('tells the model the rules, its word, the table and everything said and done so far', async () => {
    const model = new ScriptedModel({ describe: [{ candidates: ['round and red'] }] });
    await describeWord(impostorRequest('describe'), turn(model));
    const [question] = model.asked;
    expect(question?.system).toContain('as player 2 of 5');
    expect(question?.system).toContain('Your word: apple.');
    expect(question?.system).toContain('at most 60 characters a line');
    // A Reviewer 2 is never told that it is one.
    expect(question?.system).not.toMatch(/you are (a|the) reviewer 2/i);
    expect(question?.user).toContain('- Player 2 (you): in the game');
    expect(question?.user).toContain('- Player 4: voted out, was a student');
    expect(question?.user).toContain('  Player 1: (said nothing in time)');
    expect(question?.user).toContain('  Player 3: "sweet and crisp"');
    expect(question?.user).toContain(
      '  Vote: 1 voted for 4, 2 voted for 4, 3 abstained, 5 ran out of time; player 4 went out.',
    );
  });

  test('after a tie asks for one more line to stay in', async () => {
    const model = new ScriptedModel({ describe: [{ candidates: ['round and red'] }] });
    await describeWord(impostorRequest('describe', { tie: true, language: 'zh' }), turn(model));
    expect(model.asked[0]?.system).toContain('You are tied with others for the most votes');
    expect(model.asked[0]?.system).toContain('Write in Chinese, at most 60 Chinese characters a line');
  });
});

describe('a vote', () => {
  test('is for one of the players it may vote for, with the reason in one sentence', async () => {
    const model = new ScriptedModel({ vote: [{ number: 5, reason: `  Eaten raw?\n  ${'x'.repeat(400)}` }] });
    const reply = allowed(await vote(impostorRequest('vote'), turn(model)));
    expect(reply).toMatchObject({ ok: true, kind: 'vote', number: 5 });
    if (!reply.ok || reply.kind !== 'vote') throw new Error('no vote');
    expect(reply.reason.startsWith('Eaten raw? x')).toBe(true);
    expect([...reply.reason]).toHaveLength(MAX_AGENT_REASON);
    expect(reply.note.reason).toBe(reply.reason);
    expect(model.asked[0]?.system).toContain('You may vote for one of the players 1, 3, 5, or answer 0 to abstain.');
  });

  test('notes the closest word and the fit of the lines that the model wrote first', async () => {
    const model = new ScriptedModel({ vote: [{ closest: 'pear', fit: 'closest', number: 5, reason: 'Odd one.' }] });
    const reply = allowed(await vote(impostorRequest('vote'), turn(model)));
    if (!reply.ok || reply.kind !== 'vote') throw new Error('no vote');
    expect(reply.note).toMatchObject({ judgment: { closest: 'pear', fit: 'closest' }, reason: 'Odd one.' });
  });

  test('for anyone else, or for nobody, is an abstention', async () => {
    const model = new ScriptedModel({ vote: [{ number: 2, reason: 'Me.' }, { number: 0, reason: 'Unsure.' }, {}] });
    for (let ask = 0; ask < 3; ask += 1) {
      expect(allowed(await vote(impostorRequest('vote'), turn(model)))).toMatchObject({ ok: true, number: null });
    }
  });
});

describe('a verdict on a report', () => {
  test('is the one the model gives, told what was reported and which line', async () => {
    const model = new ScriptedModel({ judge: [{ verdict: 'disagree', reason: 'It is vague.' }] });
    const reply = allowed(await judge(impostorRequest('judge'), turn(model)));
    expect(reply).toMatchObject({ ok: true, kind: 'judge', verdict: 'disagree', reason: 'It is vague.' });
    expect(model.asked[0]?.system).toContain('Player 3 has reported player 5 for breaking the rules');
    expect(model.asked[0]?.system).toContain('this line of theirs: "often eaten raw"');
  });

  test('that is none of agree, disagree and abstain is an abstention', async () => {
    const model = new ScriptedModel({ judge: [{ verdict: 'guilty', reason: 'Yes.' }] });
    expect(allowed(await judge(impostorRequest('judge'), turn(model)))).toMatchObject({ verdict: 'abstain' });
  });
});

describe("a guess of the students' word", () => {
  // Player 2 was voted out in the second round, and was a Reviewer 2.
  const out = impostorRequest('comeback', {
    seats: [1, 2, 3, 4, 5].map((number) => ({
      number,
      fate: number === 2 || number === 4 ? ('voted_out' as const) : ('alive' as const),
      role: number === 2 ? ('reviewer2' as const) : number === 4 ? ('student' as const) : null,
    })),
  });

  test('is the word the model names, told that its own word was the odd one', async () => {
    const model = new ScriptedModel({ comeback: [{ word: '  pear\n' }] });
    expect(allowed(await comeback(out, turn(model)))).toMatchObject({ ok: true, kind: 'comeback', word: 'pear' });
    expect(model.asked[0]?.system).toContain("You were a Reviewer 2: your word, apple, was not the students' word");
  });

  test('is none when the model names nothing, or its own word', async () => {
    const model = new ScriptedModel({ comeback: [{ word: '' }, { word: 'Apple' }, { word: 3 }] });
    for (let ask = 0; ask < 3; ask += 1) {
      expect(allowed(await comeback(out, turn(model)))).toMatchObject({ ok: true, word: null });
    }
  });
});

describe('a failure of the model', () => {
  test('is the service failing, or no answer', async () => {
    const model = new ScriptedModel({
      describe: [new ModelError('500', true)],
      vote: [new ModelError('unreadable')],
    });
    expect(allowed(await describeWord(impostorRequest('describe'), turn(model)))).toMatchObject({
      ok: false,
      error: 'model_failed',
      note: { prompt: PROMPT_VERSION },
    });
    expect(allowed(await vote(impostorRequest('vote'), turn(model)))).toMatchObject({ ok: false, error: 'no_answer' });
  });

  test('is no answer once the wait ran out', async () => {
    const model = new ScriptedModel({ judge: [new Promise(() => {})] });
    expect(allowed(await judge(impostorRequest('judge'), turn(model, AbortSignal.timeout(20))))).toMatchObject({
      ok: false,
      error: 'no_answer',
    });
  });
});
