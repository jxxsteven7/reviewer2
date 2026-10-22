import { defaultSettings } from '@reviewer2/shared/keywords';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { giveClue, guess, type Turn } from './keywords';
import { ModelError } from './model';
import { PERSONAS, type Persona } from './personas';
import { PROMPT_VERSION } from './prompts';
import { allowed, captainCards, clueRequest, guessRequest, ScriptedModel, studentCards, THOUGHT } from './testing';

// A turn of the persona with the model, which has `waitMs` to answer: as long as a request asks for
// in a room with the default times, unless a test says otherwise.
const turn = (model: ScriptedModel, persona: Persona = PERSONAS.reviewer1, waitMs = 87_000): Turn => ({
  model,
  persona,
  signal: AbortSignal.timeout(waitMs),
  until: Date.now() + waitMs,
  hurry: new AbortController().signal,
  now: Date.now,
});

const candidate = (clue: string, targets: number[]) => ({ clue, targets, count: targets.length });
const once: Persona = { ...PERSONAS.reviewer1, rehearse: false };

afterEach(() => {
  vi.useRealTimers();
});

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

  test('asks twice more with the clues that were refused, and gives up after that', async () => {
    const refused = { candidates: [candidate('Kernels', [2]), candidate('Grants', [3])] };
    const model = new ScriptedModel({ clue: [refused, refused, { candidates: [candidate('Biology', [6, 7])] }] });
    const reply = allowed(await giveClue(clueRequest(), turn(model)));
    expect(reply).toMatchObject({ ok: true, word: 'Biology' });
    expect(model.asked[1]?.user).toMatch(/refused these clues[\s\S]*- Kernels: [\s\S]*- Grants: /);
    expect(model.asked).toHaveLength(3);

    const stubborn = new ScriptedModel({ clue: [refused, refused, refused] });
    const none = allowed(await giveClue(clueRequest(), turn(stubborn)));
    expect(none).toMatchObject({ ok: false, error: 'no_legal_clue' });
    if (none.ok) throw new Error('a clue');
    expect(none.note?.candidates).toHaveLength(6);
    expect(stubborn.asked).toHaveLength(3);
  });

  test('is refused when it aims at more cards than the persona does, and the note keeps them all', async () => {
    const stretched = candidate('Biology', [6, 7, 5, 4, 3, 2, 1, 0, 8]);
    const model = new ScriptedModel({
      clue: [{ candidates: [stretched, candidate('Space', [12, 13])] }, { candidates: [candidate('Cell', [6, 8])] }],
    });
    const reply = allowed(await giveClue(clueRequest(), turn(model)));
    expect(PERSONAS.reviewer1.targets.max).toBe(3);
    expect(reply).toMatchObject({ ok: true, word: 'Cell', count: 2, targets: [6, 8] });
    if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
    expect(reply.note.candidates?.[0]).toMatchObject({
      word: 'Biology',
      problem: 'too_many_targets',
      targets: [6, 7, 5, 4, 3, 2, 1, 0, 8],
    });
    expect(model.asked[1]?.user).toContain(
      '- Biology: it aims at 9 cards, more than the 3 that your students can follow',
    );
    // Up to the persona's most is fine.
    const three = new ScriptedModel({ clue: [{ candidates: [candidate('Biology', [6, 7, 5])] }] });
    expect(allowed(await giveClue(clueRequest(), turn(three)))).toMatchObject({
      ok: true,
      count: 3,
      targets: [6, 7, 5],
    });
  });

  test('tells the model which card each refused clue runs into', async () => {
    const english = new ScriptedModel({
      clue: [{ candidates: [candidate('Tensors', [1, 2])] }, { candidates: [candidate('Biology', [6, 7])] }],
    });
    await giveClue(clueRequest(), turn(english));
    expect(english.asked[1]?.user).toContain('- Tensors: it repeats card 1 (Tensor)');

    const cards = captainCards().map((card, index) => (index === 2 ? { ...card, word: '电场' } : card));
    const chinese = new ScriptedModel({
      clue: [{ candidates: [candidate('电磁', [1, 2])] }, { candidates: [candidate('光', [1, 2])] }],
    });
    await giveClue(clueRequest({ language: 'zh', settings: defaultSettings('zh'), cards }), turn(chinese));
    expect(chinese.asked[1]?.user).toContain('- 电磁: it shares or names a character of card 2 (电场)');
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
    expect(model.asked[0]?.system).toContain('write the clue in Chinese');
    expect(model.asked[0]?.system).toContain('at most 4 Chinese characters');
  });

  test('fails with the model, and says what it had considered', async () => {
    // The model's service is gone: the AI players are offline. The model answered nonsense, or
    // nothing in time: this clue alone is lost.
    const down = new ScriptedModel({ clue: [new ModelError('down', true)] });
    expect(allowed(await giveClue(clueRequest(), turn(down)))).toMatchObject({ ok: false, error: 'model_failed' });
    const garbled = new ScriptedModel({ clue: [new ModelError("the model's answer isn't JSON")] });
    expect(allowed(await giveClue(clueRequest(), turn(garbled)))).toMatchObject({ ok: false, error: 'no_answer' });
    const slow = new ScriptedModel({ clue: [new Promise(() => {})] });
    const short = { ...turn(slow), signal: AbortSignal.timeout(20) };
    expect(allowed(await giveClue(clueRequest(), short))).toMatchObject({ ok: false, error: 'no_answer' });
    const nonsense = new ScriptedModel({ clue: [{ candidates: 'none' }, { thoughts: [] }, { candidates: [] }] });
    expect(allowed(await giveClue(clueRequest(), turn(nonsense)))).toMatchObject({
      ok: false,
      error: 'no_legal_clue',
    });
  });

  test('is rehearsed three times over: the clue whose guesses go best on average is given', async () => {
    const picks = (...lists: number[][]) => lists.map((list) => ({ picks: list, reason: '' }));
    const model = new ScriptedModel({
      clue: [{ candidates: [candidate('Biology', [6, 7]), candidate('Physics', [0, 3]), candidate('Cell', [6, 8])] }],
      // The rehearsals go round the clues. Biology finds both its cards twice, but leads to
      // Reviewer 2 once; Physics finds one card and then one of the other group's every time; and
      // Cell finds one of its cards each time and stops at a neutral one once.
      guess: picks([6, 7], [0, 9], [8, 6], [24, 6], [0, 9], [8, 20], [7, 6], [0, 9], [6, 8]),
    });
    const reply = allowed(await giveClue(clueRequest(), turn(model)));
    expect(reply).toMatchObject({ ok: true, word: 'Cell', targets: [6, 8] });
    if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
    expect(reply.note.candidates?.map(({ rehearsals }) => rehearsals?.map(({ found, stop }) => [found, stop]))).toEqual(
      [
        [
          [2, null],
          [0, 'reviewer2'],
          [2, null],
        ],
        [
          [1, 'blue'],
          [1, 'blue'],
          [1, 'blue'],
        ],
        [
          [2, null],
          [1, 'neutral'],
          [2, null],
        ],
      ],
    );
    // The student of the rehearsal sees no color but those of the revealed cards, and doesn't think.
    expect(model.asked[1]?.user).not.toContain('[');
    expect(model.asked.slice(1).every(({ think }) => think !== true)).toBe(true);
    expect(model.asked).toHaveLength(10);
  });

  test('of a rehearsal that goes wrong everywhere is the least bad one', async () => {
    const model = new ScriptedModel({
      clue: [{ candidates: [candidate('Biology', [6, 7]), candidate('Physics', [0, 3])] }],
      guess: [24, 9, 24, 9, 24, 9].map((card) => ({ picks: [card], reason: '' })),
    });
    expect(await giveClue(clueRequest(), turn(model))).toMatchObject({ word: 'Physics' });
  });

  test("is given on the rehearsals so far when the model can't rehearse it, or the time is short", async () => {
    // The first rehearsal of Biology leads to Reviewer 2; the model fails on the next. Cell, which
    // had none, counts as a clue that is safe.
    const failing = new ScriptedModel({
      clue: [{ candidates: [candidate('Biology', [6, 7]), candidate('Cell', [6, 8])] }],
      guess: [{ picks: [24], reason: '' }, new ModelError('down')],
    });
    const reply = allowed(await giveClue(clueRequest(), turn(failing)));
    expect(reply).toMatchObject({ ok: true, word: 'Cell' });
    if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
    expect(reply.note.candidates?.map(({ rehearsals }) => rehearsals?.length)).toEqual([1, undefined]);
    // The time runs out after the first round: each clue had one rehearsal, and Biology found more.
    const clock = { time: 0 };
    const quick = new ScriptedModel({
      clue: [{ candidates: [candidate('Biology', [6, 7]), candidate('Cell', [6, 8])] }],
      guess: [
        { picks: [6, 7], reason: '' },
        { picks: [8], reason: '' },
        { picks: [24], reason: '' },
      ],
    });
    const timed: Turn = { ...turn(quick), until: 6_000, now: () => (clock.time += 1_000) };
    expect(allowed(await giveClue(clueRequest(), timed))).toMatchObject({ ok: true, word: 'Biology' });
    expect(quick.asked).toHaveLength(3);
    // A clue alone has nothing to be chosen against, and isn't rehearsed; nor are the clues of a
    // persona that doesn't rehearse.
    const alone = new ScriptedModel({ clue: [{ candidates: [candidate('Biology', [6, 7])] }] });
    await giveClue(clueRequest(), turn(alone));
    expect(alone.asked).toHaveLength(1);
    const unrehearsed = new ScriptedModel({
      clue: [{ candidates: [candidate('Biology', [6, 7]), candidate('Cell', [6, 8])] }],
    });
    expect(await giveClue(clueRequest(), turn(unrehearsed, once))).toMatchObject({ word: 'Biology' });
    expect(unrehearsed.asked).toHaveLength(1);
  });

  test('is thought of first, and the note keeps what the model thought', async () => {
    const model = new ScriptedModel({ clue: [{ candidates: [candidate('Biology', [6, 7])] }] }, 'scripted', 'low');
    const reply = allowed(await giveClue(clueRequest(), turn(model)));
    if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
    expect(reply.note).toMatchObject({ reasoning: 'low', thinking: THOUGHT });
    expect(reply.note.fellBack).toBeUndefined();
    expect(model.asked[0]?.think).toBe(true);
    // A model whose level is off doesn't think.
    const off = new ScriptedModel({ clue: [{ candidates: [candidate('Biology', [6, 7])] }] });
    const plain = allowed(await giveClue(clueRequest(), turn(off)));
    if (!plain.ok || plain.kind !== 'clue') throw new Error('no clue');
    expect(plain.note).toMatchObject({ reasoning: 'off' });
    expect(plain.note.thinking).toBeUndefined();
  });

  test('is asked for again without thinking when the model thinks too long, or fails while it thinks', async () => {
    vi.useFakeTimers();
    const slow = new ScriptedModel(
      { clue: [new Promise(() => {}), { candidates: [candidate('Biology', [6, 7])] }] },
      'scripted',
      'low',
    );
    const thinking = giveClue(clueRequest(), turn(slow, PERSONAS.reviewer1, 40_000));
    // The model may think until fifteen seconds before the end of the wait.
    await vi.advanceTimersByTimeAsync(24_000);
    expect(slow.asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    const reply = allowed(await thinking);
    expect(reply).toMatchObject({ ok: true, word: 'Biology', note: { reasoning: 'low', fellBack: true } });
    if (!reply.ok || reply.kind !== 'clue') throw new Error('no clue');
    expect(reply.note.thinking).toBeUndefined();
    expect(slow.asked.map(({ think }) => think)).toEqual([true, false]);
    vi.useRealTimers();

    const failing = new ScriptedModel(
      { clue: [new ModelError("the model's answer isn't JSON"), { candidates: [candidate('Biology', [6, 7])] }] },
      'scripted',
      'low',
    );
    expect(allowed(await giveClue(clueRequest(), turn(failing)))).toMatchObject({
      ok: true,
      note: { reasoning: 'low', fellBack: true },
    });
    // With too little time to think, the model goes without from the start; and asked again after
    // the rules refused its clues, it goes without too.
    const hurried = new ScriptedModel(
      {
        clue: [{ candidates: [candidate('Kernels', [2])] }, { candidates: [candidate('Biology', [6, 7])] }],
      },
      'scripted',
      'low',
    );
    const reply2 = allowed(await giveClue(clueRequest(), turn(hurried, PERSONAS.reviewer1, 19_000)));
    expect(reply2).toMatchObject({ ok: true, word: 'Biology', note: { reasoning: 'off' } });
    expect(hurried.asked.map(({ think }) => think)).toEqual([false, undefined]);
    if (!reply2.ok || reply2.kind !== 'clue') throw new Error('no clue');
    expect(reply2.note.fellBack).toBeUndefined();
  });

  test('stops being thought of when other requests wait for the model, and is asked for again without', async () => {
    const hurry = new AbortController();
    const slow = new ScriptedModel(
      { clue: [new Promise(() => {}), { candidates: [candidate('Biology', [6, 7])] }] },
      'scripted',
      'low',
    );
    const thinking = giveClue(clueRequest(), { ...turn(slow), hurry: hurry.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slow.asked).toHaveLength(1);
    hurry.abort();
    expect(allowed(await thinking)).toMatchObject({
      ok: true,
      word: 'Biology',
      note: { reasoning: 'low', fellBack: true },
    });
    expect(slow.asked.map(({ think }) => think)).toEqual([true, false]);
    // One that is hurried from the start goes without thinking.
    const hurried = new ScriptedModel({ clue: [{ candidates: [candidate('Biology', [6, 7])] }] }, 'scripted', 'low');
    const reply = allowed(await giveClue(clueRequest(), { ...turn(hurried), hurry: AbortSignal.abort() }));
    expect(reply).toMatchObject({ ok: true, word: 'Biology', note: { reasoning: 'off' } });
    expect(hurried.asked.map(({ think }) => think)).toEqual([false]);
  });

  test('that the rules took from a later answer notes that it fell back, keeping what the model thought', async () => {
    const model = new ScriptedModel(
      { clue: [{ candidates: [candidate('Kernels', [2])] }, { candidates: [candidate('Biology', [6, 7])] }] },
      'scripted',
      'low',
    );
    const reply = allowed(await giveClue(clueRequest(), turn(model)));
    expect(reply).toMatchObject({
      ok: true,
      word: 'Biology',
      note: { reasoning: 'low', thinking: THOUGHT, fellBack: true },
    });
    expect(model.asked.map(({ think }) => think)).toEqual([true, undefined]);
    // A clue that comes of what the model thought didn't fall back, though the rules refused some.
    const first = new ScriptedModel(
      { clue: [{ candidates: [candidate('Kernels', [2]), candidate('Biology', [6, 7])] }] },
      'scripted',
      'low',
    );
    const kept = allowed(await giveClue(clueRequest(), turn(first)));
    expect(kept).toMatchObject({ ok: true, word: 'Biology', note: { reasoning: 'low', thinking: THOUGHT } });
    if (!kept.ok || kept.kind !== 'clue') throw new Error('no clue');
    expect(kept.note.fellBack).toBeUndefined();
  });

  test('lists the characters that a clue in a Chinese room may not contain', async () => {
    const cards = captainCards().map((card, index) =>
      index < 3 ? { ...card, word: ['电场', '量子', '场论'][index] as string } : card,
    );
    const revealed = cards.map((card, index) => (index === 1 ? { ...card, revealed: true } : card));
    const model = new ScriptedModel({ clue: [{ candidates: [candidate('光', [0, 2])] }] });
    await giveClue(clueRequest({ language: 'zh', settings: defaultSettings('zh'), cards: revealed }), turn(model));
    expect(model.asked[0]?.system).toMatch(/none of which a clue may contain: 电 场 论$/);
    const english = new ScriptedModel({ clue: [{ candidates: [candidate('Biology', [6, 7])] }] });
    await giveClue(clueRequest(), turn(english));
    expect(english.asked[0]?.system).not.toContain('may contain');
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
    expect(allowed(await guess(guessRequest(), turn(empty)))).toMatchObject({ ok: false, error: 'no_answer' });
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
    const model = new ScriptedModel({ guess: [new ModelError('down', true)] });
    expect(allowed(await guess(guessRequest(), turn(model)))).toMatchObject({ ok: false, error: 'model_failed' });
    const garbled = new ScriptedModel({ guess: [new ModelError('not JSON')] });
    expect(allowed(await guess(guessRequest(), turn(garbled)))).toMatchObject({ ok: false, error: 'no_answer' });
  });

  test('tells the model what the number means, and how sure the persona is before it reveals a card', async () => {
    const counted = new ScriptedModel({ guess: [{ picks: [6], reason: '' }] });
    await guess(guessRequest(), turn(counted));
    expect(counted.asked[0]?.user).toContain("Clue: Biology, 2: the clue links 2 of our group's cards.");
    expect(counted.asked[0]?.system).toContain('list only cards that you are fairly sure of');
    const bold = { ...PERSONAS.reviewer1, caution: 'at all sure' };
    const standard = { ...defaultSettings('en'), guessRule: 'standard' as const };
    const open = new ScriptedModel({ guess: [{ picks: [6], reason: '' }] });
    await guess(guessRequest({ settings: standard, clue: { word: 'Life', count: 'unlimited' } }), turn(open, bold));
    expect(open.asked[0]?.user).toContain("Clue: Life, unlimited: the clue links any number of our group's cards");
    expect(open.asked[0]?.system).toContain('list only cards that you are at all sure of');
    // A clue of 0 warns the group off: the student goes by the earlier clues.
    const warned = new ScriptedModel({ guess: [{ picks: [6], reason: '' }] });
    await guess(guessRequest({ settings: standard, clue: { word: 'Radiation', count: 0 } }), turn(warned));
    expect(warned.asked[0]?.user).toContain("Clue: Radiation, 0: the clue links none of our group's cards");
    expect(warned.asked[0]?.user).toContain('Go by the earlier clues instead.');
  });
});
