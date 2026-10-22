import {
  cleanLine,
  MAX_AGENT_REASON,
  type AgentNote,
  type AgentReply,
  type AgentRequest,
  type BoardWord,
} from '@reviewer2/shared';
import {
  checkDescription,
  FITS,
  type ImpostorCandidate,
  type ImpostorJudgment,
  type ImpostorNote,
  type LineProblem,
  type ReportVerdict,
} from '@reviewer2/shared/impostor';
import type { Turn } from './keywords';
import { ModelError, type Question } from './model';
import {
  COMEBACK_SCHEMA,
  comebackSystem,
  comebackUser,
  describeSchema,
  describeSystem,
  describeUser,
  JUDGE_SCHEMA,
  judgeSystem,
  judgeUser,
  PROMPT_VERSION,
  voteSchema,
  voteSystem,
  voteUser,
  type RefusedLine,
} from './impostorPrompts';
import { askThinking, type Thinking } from './thinking';

// How the agent plays a turn of the hidden word game (docs/games/impostor.md#ai-players): a line
// that describes its word, its vote, its verdict on a report, and its guess of the students' word
// once it was voted out. The model only proposes; the agent holds every line against the rules of
// the room, with the same check that the game server runs (checkDescription), and every vote
// against the players it may vote for, so that what it answers is something the server takes. The
// server checks it all again anyway. The agent never reports anyone and never talks off the field.

export type ImpostorRequest = Extract<AgentRequest, { game: 'impostor' }>;
type Request<Kind extends ImpostorRequest['kind']> = Extract<ImpostorRequest, { kind: Kind }>;

// How many lines the model is asked for at a time, and how many times: twice more, with the lines
// that the rules refused, when none so far would do.
const CANDIDATES = 3;
const TRIES = 3;
// The longest line and guess that a note keeps of what the model wrote (IMPOSTOR_NOTE).
const MAX_NOTED = 200;
const MAX_GUESS = 100;
// How long before the end of its wait the model stops thinking of a move (thinking.ts), which
// leaves time to ask again without thinking.
const AFTER_THINKING_MS = 6_000;

// Why a line was refused, as the model is told when it is asked again.
const WHY: Record<LineProblem, string> = {
  line_empty: 'it says nothing',
  line_too_long: 'it is too long',
  line_has_word: 'it gives your word away',
  line_repeated: 'it repeats a line said before',
};

// The one sentence of a reason, in one line and no longer than an answer may carry.
function sentence(reason: unknown): string {
  if (typeof reason !== 'string') return '';
  return [...reason.replace(/\s+/g, ' ').trim()].slice(0, MAX_AGENT_REASON).join('');
}

// What a failure of the model makes of the turn. The wait running out comes first: the service's
// own error then says only that the request was cut short.
function failure(error: unknown, note: AgentNote, signal: AbortSignal): AgentReply {
  if (signal.aborted) return { ok: false, error: 'no_answer', note };
  if (error instanceof ModelError) return { ok: false, error: error.service ? 'model_failed' : 'no_answer', note };
  throw error;
}

// What the model worked out before its lines or its vote, when it was to (judges in
// impostorPrompts.ts): the other word closest to its own, cleaned and cut like a guess, and which
// of the two the others' lines fit, when there were lines to go by. A closest word that says
// nothing is no judgment. It goes into the note alone, never into the game.
function judgment(answer: Record<string, unknown>): ImpostorJudgment | undefined {
  if (typeof answer.closest !== 'string') return undefined;
  const closest = cleanLine(answer.closest).slice(0, MAX_GUESS);
  if (closest === '') return undefined;
  const fit = FITS.find((one) => one === answer.fit);
  return fit === undefined ? { closest } : { closest, fit };
}

// The note of a turn: the model and the prompts, the time it took, how the model thought, the lines
// considered, the judgment the model made first, if it was to, and the reason it gave.
function noter(turn: Turn, considered: ImpostorCandidate[] = []) {
  const started = turn.now();
  let thinking: Thinking = { reasoning: 'off' };
  const note = (found: { judgment?: ImpostorJudgment; reason?: string } = {}): ImpostorNote => ({
    model: turn.model.name,
    prompt: PROMPT_VERSION,
    ms: Math.round(turn.now() - started),
    ...thinking,
    ...(considered.length > 0 ? { candidates: considered } : {}),
    ...(found.judgment ? { judgment: found.judgment } : {}),
    ...(found.reason ? { reason: found.reason } : {}),
  });
  // Asks the question, letting the model think, and notes how it did.
  const ask = async (question: Question): Promise<Record<string, unknown>> => {
    const thought = await askThinking(question, turn.until - AFTER_THINKING_MS, turn);
    thinking = thought.thinking;
    return thought.value;
  };
  return { note, ask };
}

export async function describe(request: Request<'describe'>, turn: Turn): Promise<AgentReply> {
  const considered: ImpostorCandidate[] = [];
  const { note, ask } = noter(turn, considered);
  const word: BoardWord | null = request.word;
  const earlier = request.lines.flatMap(({ text }) => (text === null ? [] : [text]));
  const refused: RefusedLine[] = [];
  let judged: ImpostorJudgment | undefined;
  try {
    for (let attempt = 0; attempt < TRIES; attempt += 1) {
      const question: Question = {
        system: describeSystem(request, turn.persona, request.tie),
        user: describeUser(request, refused),
        name: 'describe',
        schema: describeSchema(request, request.tie),
        temperature: turn.persona.temperature,
      };
      // The model thinks of the first lines; it is asked again without thinking, in the time that
      // is left, and the note says how the first were found.
      const answer = attempt === 0 ? await ask(question) : (await turn.model.ask(question, turn.signal)).value;
      judged = judgment(answer) ?? judged;
      const proposed = Array.isArray(answer.candidates) ? answer.candidates.slice(0, CANDIDATES) : [];
      for (const text of proposed) {
        if (typeof text !== 'string') continue;
        const check = checkDescription(text, word, earlier, request.length);
        const shown = (check.text || cleanLine(text.slice(0, MAX_NOTED * 2))).slice(0, MAX_NOTED);
        considered.push({ text: shown, problem: check.problem });
        if (check.problem === null) {
          return { ok: true, kind: 'describe', text: check.text, note: note({ judgment: judged }) };
        }
        refused.push({ text: shown, why: WHY[check.problem] });
      }
    }
    return { ok: false, error: 'no_legal_move', note: note({ judgment: judged }) };
  } catch (error) {
    return failure(error, note({ judgment: judged }), turn.signal);
  }
}

export async function vote(request: Request<'vote'>, turn: Turn): Promise<AgentReply> {
  const { note, ask } = noter(turn);
  try {
    const answer = await ask({
      system: voteSystem(request, turn.persona, request.candidates),
      user: voteUser(request),
      name: 'vote',
      schema: voteSchema(request),
      temperature: turn.persona.temperature,
    });
    // A number that isn't one of those it may vote for is an abstention: that costs nothing.
    const number = request.candidates.includes(answer.number as number) ? (answer.number as number) : null;
    const reason = sentence(answer.reason);
    return { ok: true, kind: 'vote', number, reason, note: note({ judgment: judgment(answer), reason }) };
  } catch (error) {
    return failure(error, note(), turn.signal);
  }
}

const VERDICTS: readonly ReportVerdict[] = ['agree', 'disagree', 'abstain'];

export async function judge(request: Request<'judge'>, turn: Turn): Promise<AgentReply> {
  const { note, ask } = noter(turn);
  try {
    const answer = await ask({
      system: judgeSystem(request, turn.persona, request.report),
      user: judgeUser(request),
      name: 'judge',
      schema: JUDGE_SCHEMA,
      temperature: turn.persona.temperature,
    });
    const verdict = VERDICTS.includes(answer.verdict as ReportVerdict) ? (answer.verdict as ReportVerdict) : 'abstain';
    const reason = sentence(answer.reason);
    return { ok: true, kind: 'judge', verdict, reason, note: note({ reason }) };
  } catch (error) {
    return failure(error, note(), turn.signal);
  }
}

export async function comeback(request: Request<'comeback'>, turn: Turn): Promise<AgentReply> {
  const { note, ask } = noter(turn);
  try {
    const answer = await ask({
      system: comebackSystem(request),
      user: comebackUser(request),
      name: 'comeback',
      schema: COMEBACK_SCHEMA,
      temperature: turn.persona.temperature,
    });
    const guessed = typeof answer.word === 'string' ? cleanLine(answer.word).slice(0, MAX_GUESS) : '';
    // Its own word is no guess of the students' one.
    const own = request.word?.word.toLowerCase();
    const word = guessed === '' || guessed.toLowerCase() === own ? null : guessed;
    return { ok: true, kind: 'comeback', word, note: note() };
  } catch (error) {
    return failure(error, note(), turn.signal);
  }
}

// A turn of the hidden word game, as the kind of the request says.
export function playImpostor(request: ImpostorRequest, turn: Turn): Promise<AgentReply> {
  switch (request.kind) {
    case 'describe':
      return describe(request, turn);
    case 'vote':
      return vote(request, turn);
    case 'judge':
      return judge(request, turn);
    case 'comeback':
      return comeback(request, turn);
  }
}
