import { defaultSettings } from '@reviewer2/shared';
import { describe, expect, test } from 'vitest';
import { giveClue, guess, type Turn } from './keywords';
import { ModelError } from './model';
import { PERSONAS, type Persona } from './personas';
import { PROMPT_VERSION } from './prompts';
import { allowed, captainCards, clueRequest, guessRequest, ScriptedModel, studentCards } from './testing';

const turn = (model: ScriptedModel, persona: Persona = PERSONAS.reviewer1): Turn => ({
  model,
  persona,
  signal: AbortSignal.timeout(10_000),
  now: Date.now,
});

const candidate = (clue: string, targets: number[]) => ({ clue, targets, count: targets.length });
const rehearsing: Persona = { ...PERSONAS.reviewer1, rehearse: true };

describe('a clue', () => {
  test("is the first that the rules take, aimed at the group's own cards that are still covered", async () => {
    const model = new ScriptedModel({
      clue: [
        {
          candidates: [
            candidate('Tensors', [1, 2]),
            candidate('Space', [12, 13]),
            candidate('Biology', [6, 7, 9, 7, 30]),
          ],
        },
      ],
    });
    const reply = allowed(await giveClue(clueRequest(), turn(model)));
    expect(reply).toMatchObject({ ok: true, kind: 'clue', word: 'Biology', count: 2, targets: [6, 7] });
    if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
    expect(reply.note).toMatchObject({ model: 'scripted', prompt: PROMPT_VERSION });
    expect(reply.note.candidates?.map(({ word, problem }) => [word, problem])).toEqual([
      ['Tensors', 'clue_on_board'],
      ['Space', 'no_targets'],
      ['Biology', null],
    ]);
    expect(model.asked).toHaveLength(1);
  });

  test('tells the model whose the cards are as its group sees them, and the clues so far', async () => {
    const model = new ScriptedModel({ clue: [{ candidates: [candidate('Galaxies', [13, 14])] }] });
    const request = clueRequest({ team: 'blue', clues: [{ team: 'red', word: 'Biology', count: 2 }] });
    await giveClue(request, turn(model));
    const [question] = model.asked;
    expect(question?.user).toContain('0. Gradient [THEIRS]');
    expect(question?.user).toContain('13. Comet [OURS]');
    expect(question?.user).toContain('24. Rejection [REVIEWER 2]');
    expect(question?.user).toContain('- Biology, 2, to the other group');
    expect(question?.system).not.toMatch(/\bred\b|\bblue\b/i);
  });

  test('asks once more with the clues that were refused, and gives up after that', async () => {
    const refused = { candidates: [candidate('Kernels', [2]), candidate('Grants', [3])] };
    const model = new ScriptedModel({ clue: [refused, { candidates: [candidate('Biology', [6, 7])] }] });
    const reply = allowed(await giveClue(clueRequest(), turn(model)));
    expect(reply).toMatchObject({ ok: true, word: 'Biology' });
    expect(model.asked[1]?.user).toMatch(/refused these clues[\s\S]*- Kernels: [\s\S]*- Grants: /);

    const stubborn = new ScriptedModel({ clue: [refused, refused] });
    const none = allowed(await giveClue(clueRequest(), turn(stubborn)));
    expect(none).toMatchObject({ ok: false, error: 'no_clue' });
    if (none.ok) throw new Error('a clue');
    expect(none.note?.candidates).toHaveLength(4);
    expect(stubborn.asked).toHaveLength(2);
  });

  test('is never one that was given before', async () => {
    const model = new ScriptedModel({
      clue: [{ candidates: [candidate('biology', [6, 7]), candidate('Cell', [6, 8])] }],
    });
    const request = clueRequest({ clues: [{ team: 'blue', word: 'Biology', count: 2 }] });
    const reply = allowed(await giveClue(request, turn(model)));
    expect(reply).toMatchObject({ ok: true, word: 'Cell' });
    if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
    expect(reply.note.candidates?.[0]?.problem).toBe('clue_given');
  });

  test('is clean before it is only allowed: a warning goes last', async () => {
    const model = new ScriptedModel({
      clue: [{ candidates: [candidate('Orbital', [0, 1])] }, { candidates: [candidate('Orbital', [0, 1])] }],
    });
    // Only a clue with a warning: it will do, under the room's rule, and the note says why it isn't clean.
    const reply = allowed(await giveClue(clueRequest(), turn(model)));
    expect(reply).toMatchObject({ ok: true, word: 'Orbital' });
    if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
    expect(reply.note.candidates?.[0]?.problem).toBe('clue_similar');

    const both = new ScriptedModel({
      clue: [{ candidates: [candidate('Orbital', [0, 1]), candidate('Biology', [6, 7])] }],
    });
    expect(await giveClue(clueRequest(), turn(both))).toMatchObject({ ok: true, word: 'Biology' });
  });

  test('has a number that the room allows', async () => {
    // Under the free rule the number is at most the cards the group has left.
    const cards = captainCards([0, 1, 2, 3, 4, 5, 6]);
    const model = new ScriptedModel({ clue: [{ candidates: [candidate('Biology', [6, 7, 8])] }] });
    const reply = allowed(await giveClue(clueRequest({ cards }), turn(model)));
    expect(reply).toMatchObject({ ok: true, count: 2, targets: [7, 8] });

    const standard = { ...defaultSettings('en'), guessRule: 'standard' as const };
    const again = new ScriptedModel({ clue: [{ candidates: [candidate('Biology', [6, 7, 8])] }] });
    expect(await giveClue(clueRequest({ settings: standard }), turn(again))).toMatchObject({ count: 3 });
  });

  test('is checked by the rules of a Chinese room, and asked for in Chinese', async () => {
    const cards = captainCards().map((card, index) => (index === 6 ? { ...card, word: '蛋白质' } : card));
    const model = new ScriptedModel({
      clue: [{ candidates: [candidate('蛋白', [6, 7]), candidate('生物', [6, 7])] }],
    });
    const request = clueRequest({ language: 'zh', settings: defaultSettings('zh'), cards });
    const reply = allowed(await giveClue(request, turn(model)));
    expect(reply).toMatchObject({ ok: true, word: '生物' });
    expect(model.asked[0]?.system).toContain('write the clue in Chinese, as one word of at most 4 Chinese characters');
  });

  test('fails with the model, and says what it had considered', async () => {
    const model = new ScriptedModel({ clue: [new ModelError('down')] });
    expect(allowed(await giveClue(clueRequest(), turn(model)))).toMatchObject({ ok: false, error: 'model_failed' });
    const nonsense = new ScriptedModel({ clue: [{ candidates: 'none' }, { thoughts: [] }] });
    expect(allowed(await giveClue(clueRequest(), turn(nonsense)))).toMatchObject({ ok: false, error: 'no_clue' });
  });

  test('can be rehearsed: the clue whose guesses go best is given', async () => {
    const model = new ScriptedModel({
      clue: [{ candidates: [candidate('Biology', [6, 7]), candidate('Physics', [0, 3]), candidate('Cell', [6, 8])] }],
      // Biology leads to Reviewer 2, Physics finds one card and then one of the other group's,
      // and Cell finds both of its cards.
      guess: [
        { picks: [24, 6], reason: '' },
        { picks: [0, 9], reason: '' },
        { picks: [8, 6], reason: '' },
      ],
    });
    const reply = allowed(await giveClue(clueRequest(), turn(model, rehearsing)));
    expect(reply).toMatchObject({ ok: true, word: 'Cell', targets: [6, 8] });
    if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
    expect(reply.note.candidates?.map(({ rehearsal }) => rehearsal)).toEqual([
      { picks: [24, 6], found: 0, stop: 'reviewer2' },
      { picks: [0, 9], found: 1, stop: 'blue' },
      { picks: [8, 6], found: 2, stop: null },
    ]);
    // The student of the rehearsal sees no color but those of the revealed cards.
    expect(model.asked[1]?.user).not.toContain('[');
  });

  test('of a rehearsal that goes wrong everywhere is the least bad one', async () => {
    const model = new ScriptedModel({
      clue: [{ candidates: [candidate('Biology', [6, 7]), candidate('Physics', [0, 3])] }],
      guess: [
        { picks: [24], reason: '' },
        { picks: [9], reason: '' },
      ],
    });
    expect(await giveClue(clueRequest(), turn(model, rehearsing))).toMatchObject({ word: 'Physics' });
  });

  test("is given without its rehearsal when the model can't rehearse it", async () => {
    const model = new ScriptedModel({
      clue: [{ candidates: [candidate('Biology', [6, 7]), candidate('Cell', [6, 8])] }],
      guess: [new ModelError('down')],
    });
    expect(allowed(await giveClue(clueRequest(), turn(model, rehearsing)))).toMatchObject({
      ok: true,
      word: 'Biology',
    });
  });
});

describe('a guess', () => {
  test("names covered cards, each once, no more than the clue's number, with a reason", async () => {
    const model = new ScriptedModel({
      guess: [{ picks: [3, 3, 99, 6, 7, 8], reason: '  Proteins\n and   enzymes. ' }],
    });
    const reply = allowed(await guess(guessRequest({ cards: studentCards([3]) }), turn(model)));
    expect(reply).toMatchObject({ ok: true, kind: 'guess', picks: [6, 7], reason: 'Proteins and enzymes.' });
    expect(model.asked[0]?.system).toContain('at most 2');
    expect(model.asked[0]?.user).toContain('3. Matrix [OURS] (revealed)');
    expect(model.asked[0]?.user).not.toContain('6. Protein [');
  });

  test('names no more cards than the group may still reveal, and a few for a number that says nothing', async () => {
    const limited = new ScriptedModel({ guess: [{ picks: [6, 7, 8], reason: '' }] });
    const standard = { ...defaultSettings('en'), guessRule: 'standard' as const };
    const one = await guess(
      guessRequest({ settings: standard, clue: { word: 'Biology', count: 3 }, guessesLeft: 1 }),
      turn(limited),
    );
    expect(one).toMatchObject({ picks: [6] });
    const open = new ScriptedModel({ guess: [{ picks: [6, 7, 8, 5, 4], reason: '' }] });
    const many = await guess(
      guessRequest({ settings: standard, clue: { word: 'Life', count: 'unlimited' } }),
      turn(open),
    );
    expect(many).toMatchObject({ picks: [6, 7, 8] });
  });

  test('always names a card, or fails', async () => {
    const empty = new ScriptedModel({ guess: [{ picks: [], reason: 'Not sure.' }] });
    expect(allowed(await guess(guessRequest(), turn(empty)))).toMatchObject({ ok: false, error: 'model_failed' });
    const revealed = new ScriptedModel({ guess: [{ picks: [6], reason: '' }] });
    expect(await guess(guessRequest({ cards: studentCards([6]) }), turn(revealed))).toMatchObject({ ok: false });
  });

  test('gives a reason no longer than an answer may carry', async () => {
    const model = new ScriptedModel({ guess: [{ picks: [6], reason: '很'.repeat(500) }] });
    const reply = allowed(await guess(guessRequest(), turn(model)));
    if (!reply.ok || reply.kind !== 'guess') throw new Error('no guess');
    expect([...reply.reason]).toHaveLength(200);
  });

  test('fails with the model', async () => {
    const model = new ScriptedModel({ guess: [new ModelError('down')] });
    expect(allowed(await guess(guessRequest(), turn(model)))).toMatchObject({ ok: false, error: 'model_failed' });
  });
});
