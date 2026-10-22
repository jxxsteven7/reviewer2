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

// The first round of the same game, as player 2 sees it: everyone is in, and before player 2 only
// player 1 has spoken, or nobody.
const firstRound = (spoken: boolean) => ({
  round: 1,
  seats: [1, 2, 3, 4, 5].map((number) => ({ number, fate: 'alive' as const, role: null })),
  lines: spoken ? [{ round: 1, number: 1, text: 'grows on a tree', tie: false }] : [],
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
const LEAN =
  /If most of the lines fit another word better than yours, yours is probably the odd one: say only what your word shares with that word, leaning toward it, as vaguely as you can, and never anything that only your word has\./;
const AS_USUAL =
  /If they fit your word, a good line is true of your word but vague: specific enough that the players who share your word recognize it/;
const MAJORITY = /First work out from the lines alone the word that most players seem to have: it may not be yours\./;
const NOT_THE_STUDENTS =
  /If it is not, you are probably a Reviewer 2, and the players whose lines fit it are probably students: never vote for one of them, which would give you away\. Vote, as a student would, for the player whose lines fit that word the least, or abstain\./;
const POINTS =
  /A vote for a Reviewer 2 or the PI brings you a point, whatever comes of it; a vote that puts a student out costs you one; abstaining costs nothing, but helps nobody\. Choose the vote that these points favor most\./;
// What the PI, who has no word, was always told.
const PI_LINE =
  /\nA good line is true of your word but vague: specific enough that the players who share your word recognize it, and vague enough that a player with the other word can't work yours out\. Fit in with what the others said, without repeating it\.\n/;
const PI_VOTE =
  /\nIt is time to vote\. Vote for the player whose lines fit the word that most players seem to have the least: that player probably has another word, or none\. Voting out a student costs you a point; abstaining costs nothing, but helps nobody\.\n/;
const IN_CHINESE =
  /Give your reason in one short sentence in Chinese, calm and brief, like a polite senior colleague\. Write all of it in Chinese, with no words of another language: name the players and the roles in Chinese too, never as "Player 3", "PI" or "Reviewer 2"\./;
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
    for (const spoken of [false, true]) {
      const system = await told('describe', firstRound(spoken));
      expect(system).toMatch(FIRST_ROUND);
      expect(system).toMatch(BROAD);
      expect(system).toMatch(
        /If most of the lines so far already fit another word better than yours, lean toward that word\./,
      );
      expect(system).not.toMatch(LEAN);
      expect(system).not.toMatch(AS_USUAL);
    }
  });

  test('after it, or for a tie, ask for a line that leans toward the word most players seem to have, when it is not its own', async () => {
    for (const changes of [{}, { ...firstRound(true), tie: true }]) {
      const system = await told('describe', changes);
      expect(system).toMatch(LEAN);
      expect(system).toMatch(AS_USUAL);
      expect(system).toContain('Fit in with what the others said, without repeating it.');
      expect(system).not.toMatch(FIRST_ROUND);
      expect(system).not.toMatch(BROAD);
    }
  });

  test('ask a player with a word to vote by the word most players seem to have, and by the points', async () => {
    const system = await told('vote');
    expect(system).toMatch(MAJORITY);
    expect(system).toMatch(
      /If it is yours, vote for the player whose lines fit it the least: that player probably has another word, or none\./,
    );
    expect(system).toMatch(NOT_THE_STUDENTS);
    expect(system).toMatch(POINTS);
    expect(system).not.toMatch(PI_VOTE);
  });

  test("leave the PI's line and vote as they were", async () => {
    for (const changes of [{ word: null }, { ...firstRound(false), word: null }, { word: null, tie: true }]) {
      const system = await told('describe', changes);
      expect(system).toContain('You are the PI: you have no word.');
      expect(system).toMatch(PI_LINE);
      for (const phrase of [FIRST_ROUND, BROAD, LEAN, AS_USUAL]) expect(system).not.toMatch(phrase);
    }
    const vote = await told('vote', { word: null });
    expect(vote).toMatch(PI_VOTE);
    for (const phrase of [MAJORITY, NOT_THE_STUDENTS, POINTS]) expect(vote).not.toMatch(phrase);
  });

  test('ask for the reason of a vote or a verdict all in the language of the room', async () => {
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

  test('are noted with a new version of the prompts', () => {
    expect(PROMPT_VERSION).toBe('impostor-2');
  });
});
