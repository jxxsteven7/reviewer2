import { POINTS, WIN_POINTS, type ImpostorRole } from '@reviewer2/shared/impostor';
import { describe, expect, test } from 'vitest';
import { playImpostor, type ImpostorRequest } from './impostor';
import { PROMPT_VERSION } from './impostorPrompts';
import { PERSONAS } from './personas';
import { allowed, impostorRequest, ScriptedModel } from './testing';

type Asked = 'describe' | 'vote' | 'judge';

const ANSWERS: Record<Asked, Record<string, unknown>> = {
  describe: { candidates: ['round and red'] },
  vote: { number: 5, reason: 'Vague.' },
  judge: { verdict: 'disagree', reason: 'Vague.' },
};

// What the model is asked for a line, a vote or a verdict, by the agent itself with a model that
// answers from a script, in the game of five of testing.ts, changed as given: what it is told,
// and the fields of its answer, in the order it writes them.
async function asked<Kind extends Asked>(
  kind: Kind,
  changes: Partial<Extract<ImpostorRequest, { kind: Kind }>> = {},
): Promise<{ system: string; fields: string[] }> {
  const model = new ScriptedModel({ [kind]: [ANSWERS[kind]] });
  const turn = {
    model,
    persona: PERSONAS.reviewer1,
    signal: AbortSignal.timeout(10_000),
    until: Date.now() + 10_000,
    hurry: new AbortController().signal,
    now: Date.now,
  };
  const reply = allowed(await playImpostor(impostorRequest(kind, changes), turn));
  expect(reply).toMatchObject({ ok: true, note: { prompt: PROMPT_VERSION } });
  const question = model.asked[0];
  const schema = question?.schema as { properties: Record<string, unknown>; required: string[] };
  expect(schema.required).toEqual(Object.keys(schema.properties));
  return { system: question?.system ?? '', fields: schema.required };
}

const told = async <Kind extends Asked>(
  kind: Kind,
  changes: Partial<Extract<ImpostorRequest, { kind: Kind }>> = {},
): Promise<string> => (await asked(kind, changes)).system;

const seats = (players: number, out: Record<number, ImpostorRole> = {}) =>
  Array.from({ length: players }, (_, index) => index + 1).map((number) => ({
    number,
    fate: number in out ? ('voted_out' as const) : ('alive' as const),
    role: out[number] ?? null,
  }));

// The first round of the same game, as the player after the ones who have spoken sees it: everyone
// is in, and the players before it have spoken, each a line or nothing in time.
const firstRound = (spoken: (string | null)[]) => ({
  round: 1,
  number: spoken.length + 1,
  seats: seats(5),
  lines: spoken.map((text, index) => ({ round: 1, number: index + 1, text, tie: false })),
  ballots: [],
});

const YOU_TOO =
  /Nobody is told whether their word is the students' one or the odd one, and that goes for you too: you may be a Reviewer 2 without knowing it\./;
const CHECK_FIRST =
  /So never take it that the others share your word: name the other word closest to yours first, the one most likely paired with it, and hold their lines against both\. When they clearly fit that word better than yours, yours is probably the odd one, and you are probably a Reviewer 2\./;
const FIRST_ROUND =
  /This is the first round, so there is little to hold your word against yet, if anything: stay broad\. Say only the field or the kind that your word and closest both belong to, or one property that both have, never a use, a mechanism or any feature that tells one from the other, so that your line fits whichever of the two the others have\./;
const BY_FIT =
  /Describe by fit\. If it is closest, take closest for your word and describe it, vaguely, as the players who have it would, and never anything that only your own word has: that is how a player with the odd word plays\. If it is unclear, say only what both words have\./;
const AS_USUAL =
  /If it is mine, a good line is true of your word but vague: specific enough that the players who share your word recognize it/;
// The answers of a player who writes the closest word first, and the fit of the lines too, and of
// one who writes neither.
const CLOSEST =
  'Answer in JSON: closest, the other word closest to yours, the one most likely paired with it in this game: a specific word or term, never a category or a summary';
const FIT =
  "fit, which of the two the others' lines fit better: mine, closest or unclear, closest only when they clearly fit it better than yours, and unclear when you can't tell";
const CLOSEST_LINE = `\n${CLOSEST}; then candidates, 3 different lines, the best first.`;
const JUDGED_LINE = `\n${CLOSEST}; ${FIT}; then candidates, 3 different lines, the best first, by what you found.`;
const JUDGED_VOTE = `\n${CLOSEST}; ${FIT}; then number and reason, by what you found.`;
const PLAIN_LINE = '\nAnswer in JSON: candidates, 3 different lines, the best first.';
const PLAIN_VOTE = '\nAnswer in JSON: number and reason.';
const NAME_FIRST = /It is time to vote\. First name closest, and judge fit from the lines alone: it may not be mine\./;
const MINE =
  /If fit is mine, vote for the player whose lines fit your word the least: that player probably has another word, or none\./;
const NOT_THE_STUDENTS =
  /If fit is closest, you are probably a Reviewer 2, and your side wins only while one of you is still in the game\. The players whose lines fit closest are probably students: never vote for one of them, which would give you away\./;
const PARTNER =
  /A player whose lines fit your own word better than closest is probably the other Reviewer 2, on your side: never vote for them either\./;
// Whom to vote for then: the player whose lines fit neither word, named as the PI only while one
// may still be in.
const NEITHER = /Vote for a player whose lines fit neither word, who is probably the PI, or abstain\./;
const NO_PI =
  /give you away\.(?: A player whose lines fit .*? either\.)? Vote for a player whose lines fit neither word, or abstain\./;
const UNCLEAR = /If fit is unclear, vote for the player whose lines fit the others' lines the least, or abstain\./;
const POINTS_TOLD =
  /The points: a vote for a Reviewer 2 or the PI is worth \+1, whatever comes of it; a vote that puts a student out, -1; abstaining, 0\. Your side winning is worth \+3 to a student, \+5 to a Reviewer 2 and \+6 to the PI, and \+1 more when you are still in the game then, so keeping your side in the game outweighs any one vote\. Choose the vote that these points favor most\./;
// What the PI, who has no word, was always told.
const PI_LINE =
  /\nA good line is true of your word but vague: specific enough that the players who share your word recognize it, and vague enough that a player with the other word can't work yours out\. Fit in with what the others said, without repeating it\.\n/;
const PI_VOTE =
  /\nIt is time to vote\. Vote for the player whose lines fit the word that most players seem to have the least: that player probably has another word, or none\. Voting out a student costs you a point; abstaining costs nothing, but helps nobody\.\n/;
const IN_CHINESE =
  /Give your reason in one short sentence in Chinese, calm and brief, like a polite senior colleague\. Write all of it in Chinese, with no words of another language: write a player by number as "3 号", and the roles as 学生, 二号审稿人 and 导师, never as "Player 3", "PI" or "Reviewer 2"\./;
const IN_ENGLISH =
  /Give your reason in one short sentence in English, calm and brief, like a polite senior colleague\. Write all of it in English, with no words of another language\./;

describe('the prompts of the hidden word game', () => {
  test('tell a player with a word that it may hold the odd one itself, and to hold the lines against the closest word too', async () => {
    for (const kind of ['describe', 'vote', 'judge'] as const) {
      const system = await told(kind);
      expect(system).toContain('Your word: apple.');
      expect(system).toMatch(YOU_TOO);
      // Judging a report, it writes no closest word, so it isn't told to name one first.
      if (kind === 'judge') expect(system).not.toMatch(CHECK_FIRST);
      else expect(system).toMatch(CHECK_FIRST);
      // The PI has no word to hold against them.
      const pi = await told(kind, { word: null });
      expect(pi).not.toMatch(YOU_TOO);
      expect(pi).not.toMatch(CHECK_FIRST);
    }
  });

  test('in the first round, ask a player with a word for the closest word, and a line on what both words share', async () => {
    const lines = ['grows on a tree', 'sweet and crisp', 'often eaten raw', 'keeps the doctor away'];
    // Whoever has spoken before it: the fit of so few lines is not judged.
    for (const spoken of [0, 1, 2, 4]) {
      const { system, fields } = await asked('describe', firstRound(lines.slice(0, spoken)));
      expect(fields).toEqual(['closest', 'candidates']);
      expect(system.endsWith(CLOSEST_LINE)).toBe(true);
      expect(system).toMatch(FIRST_ROUND);
      expect(system).not.toMatch(BY_FIT);
      expect(system).not.toMatch(AS_USUAL);
    }
  });

  test('after it, or for a tie, ask for the closest word and the fit of the lines first, and a line by the fit', async () => {
    for (const changes of [{}, { ...firstRound(lines(4)), tie: true }]) {
      const { system, fields } = await asked('describe', changes);
      expect(fields).toEqual(['closest', 'fit', 'candidates']);
      expect(system.endsWith(JUDGED_LINE)).toBe(true);
      expect(system).toMatch(BY_FIT);
      expect(system).toMatch(AS_USUAL);
      expect(system).toContain('Fit in with what the others said, without repeating it.');
      expect(system).not.toMatch(FIRST_ROUND);
    }
  });

  test('ask a player with a word for the closest word and the fit first, and to vote by the fit and the points', async () => {
    const { system, fields } = await asked('vote');
    expect(fields).toEqual(['closest', 'fit', 'number', 'reason']);
    expect(system.endsWith(JUDGED_VOTE)).toBe(true);
    for (const phrase of [NAME_FIRST, MINE, NOT_THE_STUDENTS, NO_PI, UNCLEAR, POINTS_TOLD])
      expect(system).toMatch(phrase);
    expect(system).not.toMatch(PI_VOTE);
  });

  test('tell a player with a word of the other Reviewer 2, on its side, while a game has two in it', async () => {
    // A game of five has one Reviewer 2.
    expect(await told('vote')).not.toMatch(PARTNER);
    // A game of nine has two, until one of them is out.
    const nine = { seats: seats(9), candidates: [1, 3, 5, 6, 7, 8, 9] };
    expect(await told('vote', nine)).toMatch(PARTNER);
    expect(await told('vote', { ...nine, seats: seats(9, { 4: 'reviewer2' }) })).not.toMatch(PARTNER);
    expect(await told('vote', { ...nine, seats: seats(9, { 4: 'student' }) })).toMatch(PARTNER);
  });

  test('name the player whose lines fit neither word as the PI only while one may still be in the game', async () => {
    // A game of five has none.
    const five = await told('vote');
    expect(five).toMatch(NO_PI);
    expect(five).not.toMatch(NEITHER);
    // A game of six or more may have one, until it is out.
    for (const players of [6, 9]) {
      const game = { seats: seats(players), candidates: [1, 3, 5, 6] };
      const told6 = await told('vote', game);
      expect(told6).toMatch(NEITHER);
      expect(told6).not.toMatch(NO_PI);
      expect(await told('vote', { ...game, seats: seats(players, { 4: 'student' }) })).toMatch(NEITHER);
      const piOut = await told('vote', { ...game, seats: seats(players, { 4: 'pi' }) });
      expect(piOut).toMatch(NO_PI);
      expect(piOut).not.toMatch(NEITHER);
    }
    // With the other Reviewer 2 still in, but no PI, it is told of both.
    expect(await told('vote', { seats: seats(9, { 4: 'pi' }), candidates: [1, 3, 5, 6, 7, 8, 9] })).toMatch(
      /A player whose lines fit your own word better than closest is probably the other Reviewer 2, on your side: never vote for them either\. Vote for a player whose lines fit neither word, or abstain\./,
    );
  });

  test("leave the PI's line and vote as they were, with no judgment first", async () => {
    for (const changes of [{ word: null }, { ...firstRound([]), word: null }, { word: null, tie: true }]) {
      const { system, fields } = await asked('describe', changes);
      expect(fields).toEqual(['candidates']);
      expect(system.endsWith(PLAIN_LINE)).toBe(true);
      expect(system).toContain('You are the PI: you have no word.');
      expect(system).toMatch(PI_LINE);
      for (const phrase of [FIRST_ROUND, BY_FIT, AS_USUAL]) expect(system).not.toMatch(phrase);
    }
    const vote = await asked('vote', { word: null });
    expect(vote.fields).toEqual(['number', 'reason']);
    expect(vote.system.endsWith(PLAIN_VOTE)).toBe(true);
    expect(vote.system).toMatch(PI_VOTE);
    for (const phrase of [NAME_FIRST, MINE, NOT_THE_STUDENTS, NEITHER, NO_PI, UNCLEAR, POINTS_TOLD]) {
      expect(vote.system).not.toMatch(phrase);
    }
  });

  test('ask for the reason of a vote or a verdict all in the language of the room, with the names the game shows', async () => {
    for (const kind of ['vote', 'judge'] as const) {
      // The PI's reason too.
      for (const word of [{}, { word: null }]) {
        const chinese = await told(kind, { language: 'zh', ...word });
        expect(chinese).toMatch(IN_CHINESE);
        expect(chinese).not.toMatch(IN_ENGLISH);
        const english = await told(kind, word);
        expect(english).toMatch(IN_ENGLISH);
        expect(english).not.toMatch(/never as "Player 3"/);
      }
    }
  });

  test('leave how a report is judged as it was', async () => {
    expect(await told('judge')).toContain(
      "The rules: a line describes the player's own word, and must not give the word away, nor say who has which " +
        'word. A report that passes puts the player out; one that fails costs the reporter a point. Agree only ' +
        "when the rules were clearly broken; disagree when they were not; abstain when you can't tell.",
    );
  });

  // The prompts tell the points as the rules set them now, so a change to the points changes what
  // the model is told, and takes a new version of the prompts with it.
  test('are noted with a new version of the prompts, which tell the points of the rules', () => {
    expect(PROMPT_VERSION).toBe('impostor-2');
    expect({ ...WIN_POINTS, hit: POINTS.hit, wrong: POINTS.wrong, lasted: POINTS.lasted }).toEqual({
      student: 3,
      reviewer2: 5,
      pi: 6,
      hit: 1,
      wrong: -1,
      lasted: 1,
    });
  });
});

// So many lines of the first round, one each from the players before the one asked.
function lines(count: number): string[] {
  return ['grows on a tree', 'sweet and crisp', 'often eaten raw', 'keeps the doctor away'].slice(0, count);
}
