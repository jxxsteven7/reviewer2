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

// What the model is told for a line, a vote or a verdict, asked by the agent itself with a model
// that answers from a script, in the game of five of testing.ts, changed as given.
async function told<Kind extends Asked>(
  kind: Kind,
  changes: Partial<Extract<ImpostorRequest, { kind: Kind }>> = {},
): Promise<string> {
  const model = new ScriptedModel({ [kind]: [ANSWERS[kind]] });
  const turn = { model, persona: PERSONAS.reviewer1, signal: AbortSignal.timeout(10_000), now: Date.now };
  const reply = allowed(await playImpostor(impostorRequest(kind, changes), turn));
  expect(reply).toMatchObject({ ok: true, note: { prompt: PROMPT_VERSION } });
  return model.asked[0]?.system ?? '';
}

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
  /So never take it that the others share your word: hold it against their lines first\. If most of them fit a different, related word better than yours, yours is probably the odd one/;
const FIRST_ROUND =
  /This is the first round, so there is little to hold your word against yet, if anything: stay broad\./;
const BROAD =
  /Say only what your word shares with the words closest to it, never a detail that tells it apart from them, so that your line fits whichever of two close words the others have\./;
const LEAN_FIRST = /If most of the lines so far fit another word better than yours, lean toward that word\./;
const TOO_FEW = /Too few have spoken yet to tell which word most players have, so lean toward no other word\./;
const LEAN =
  /If most of the lines fit another word better than yours, yours is probably the odd one: say only what your word shares with that word, leaning toward it, as vaguely as you can, and never anything that only your word has\./;
const AS_USUAL =
  /If they fit your word, a good line is true of your word but vague: specific enough that the players who share your word recognize it/;
const MAJORITY = /First work out from the lines alone the word that most players seem to have: it may not be yours\./;
const NOT_THE_STUDENTS =
  /If it is not, you are probably a Reviewer 2, and your side wins only while one of you is still in the game\. The players whose lines fit that word are probably students: never vote for one of them, which would give you away\./;
const PARTNER =
  /A player whose lines lean toward your word, as yours do, is probably the other Reviewer 2, on your side: never vote for them either\./;
const NEITHER = /Vote for a player whose lines fit neither word, who is probably the PI, or abstain\./;
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
  test('tell a player with a word that it may hold the odd one itself, and to hold its word against the lines', async () => {
    for (const kind of ['describe', 'vote', 'judge'] as const) {
      const system = await told(kind);
      expect(system).toContain('Your word: apple.');
      expect(system).toMatch(YOU_TOO);
      expect(system).toMatch(CHECK_FIRST);
      // The PI has no word to hold against them.
      const pi = await told(kind, { word: null });
      expect(pi).not.toMatch(YOU_TOO);
      expect(pi).not.toMatch(CHECK_FIRST);
    }
  });

  test('in the first round, ask a player with a word for a broad line, which fits either of two close words', async () => {
    const lines = ['grows on a tree', 'sweet and crisp', 'often eaten raw', 'keeps the doctor away'];
    for (const spoken of [0, 1, 2, 4]) {
      const system = await told('describe', firstRound(lines.slice(0, spoken)));
      expect(system).toMatch(FIRST_ROUND);
      expect(system).toMatch(BROAD);
      expect(system).not.toMatch(LEAN);
      expect(system).not.toMatch(AS_USUAL);
      // It leans toward another word only once half of the other four have spoken.
      expect(system).toMatch(spoken < 2 ? TOO_FEW : LEAN_FIRST);
      expect(system).not.toMatch(spoken < 2 ? LEAN_FIRST : TOO_FEW);
    }
    // A line that was not said in time is no line to go by.
    const missed = await told('describe', firstRound([null, 'sweet and crisp']));
    expect(missed).toMatch(TOO_FEW);
  });

  test('after it, or for a tie, ask for a line that leans toward the word most players seem to have, when it is not its own', async () => {
    for (const changes of [{}, { ...firstRound(['grows on a tree']), tie: true }]) {
      const system = await told('describe', changes);
      expect(system).toMatch(LEAN);
      expect(system).toMatch(AS_USUAL);
      expect(system).toContain('Fit in with what the others said, without repeating it.');
      for (const phrase of [FIRST_ROUND, BROAD, LEAN_FIRST, TOO_FEW]) expect(system).not.toMatch(phrase);
    }
  });

  test('ask a player with a word to vote by the word most players seem to have, and by the points of a vote and a win', async () => {
    const system = await told('vote');
    expect(system).toMatch(MAJORITY);
    expect(system).toMatch(
      /If it is yours, vote for the player whose lines fit it the least: that player probably has another word, or none\./,
    );
    expect(system).toMatch(NOT_THE_STUDENTS);
    expect(system).toMatch(NEITHER);
    expect(system).toMatch(POINTS_TOLD);
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

  test("leave the PI's line and vote as they were", async () => {
    for (const changes of [{ word: null }, { ...firstRound([]), word: null }, { word: null, tie: true }]) {
      const system = await told('describe', changes);
      expect(system).toContain('You are the PI: you have no word.');
      expect(system).toMatch(PI_LINE);
      for (const phrase of [FIRST_ROUND, BROAD, LEAN_FIRST, TOO_FEW, LEAN, AS_USUAL])
        expect(system).not.toMatch(phrase);
    }
    const vote = await told('vote', { word: null });
    expect(vote).toMatch(PI_VOTE);
    for (const phrase of [MAJORITY, NOT_THE_STUDENTS, NEITHER, POINTS_TOLD]) expect(vote).not.toMatch(phrase);
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
