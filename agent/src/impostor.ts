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
  type ImpostorCandidate,
  type LineProblem,
  type ReportVerdict,
} from '@reviewer2/shared/impostor';
import { ModelError } from './model';
import type { Turn } from './keywords';
import {
  COMEBACK_SCHEMA,
  comebackSystem,
  comebackUser,
  DESCRIBE_SCHEMA,
  describeSystem,
  describeUser,
  JUDGE_SCHEMA,
  judgeSystem,
  judgeUser,
  PROMPT_VERSION,
  VOTE_SCHEMA,
  voteSystem,
  voteUser,
  type RefusedLine,
} from './impostorPrompts';

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

// The note of a turn: the model and the prompts, the time it took, and the lines considered.
function noter(turn: Turn, considered: ImpostorCandidate[] = []) {
  const started = turn.now();
  return (reason?: string): AgentNote<ImpostorCandidate> => ({
    model: turn.model.name,
    prompt: PROMPT_VERSION,
    ms: Math.round(turn.now() - started),
    ...(considered.length > 0 ? { candidates: considered } : {}),
    ...(reason ? { reason } : {}),
  });
}

export async function describe(request: Request<'describe'>, turn: Turn): Promise<AgentReply> {
  const considered: ImpostorCandidate[] = [];
  const note = noter(turn, considered);
  const word: BoardWord | null = request.word;
  const earlier = request.lines.flatMap(({ text }) => (text === null ? [] : [text]));
  const refused: RefusedLine[] = [];
  try {
    for (let attempt = 0; attempt < TRIES; attempt += 1) {
      const answer = await turn.model.ask(
        {
          system: describeSystem(request, turn.persona, request.tie),
          user: describeUser(request, refused),
          name: 'describe',
          schema: DESCRIBE_SCHEMA,
          temperature: turn.persona.temperature,
        },
        turn.signal,
      );
      const proposed = Array.isArray(answer.candidates) ? answer.candidates.slice(0, CANDIDATES) : [];
      for (const text of proposed) {
        if (typeof text !== 'string') continue;
        const check = checkDescription(text, word, earlier, request.length);
        const shown = (check.text || cleanLine(text.slice(0, MAX_NOTED * 2))).slice(0, MAX_NOTED);
        considered.push({ text: shown, problem: check.problem });
        if (check.problem === null) return { ok: true, kind: 'describe', text: check.text, note: note() };
        refused.push({ text: shown, why: WHY[check.problem] });
      }
    }
    return { ok: false, error: 'no_legal_move', note: note() };
  } catch (error) {
    return failure(error, note(), turn.signal);
  }
}

export async function vote(request: Request<'vote'>, turn: Turn): Promise<AgentReply> {
  const note = noter(turn);
  try {
    const answer = await turn.model.ask(
      {
        system: voteSystem(request, turn.persona, request.candidates),
        user: voteUser(request),
        name: 'vote',
        schema: VOTE_SCHEMA,
        temperature: turn.persona.temperature,
      },
      turn.signal,
    );
    // A number that isn't one of those it may vote for is an abstention: that costs nothing.
    const number = request.candidates.includes(answer.number as number) ? (answer.number as number) : null;
    const reason = sentence(answer.reason);
    return { ok: true, kind: 'vote', number, reason, note: note(reason) };
  } catch (error) {
    return failure(error, note(), turn.signal);
  }
}

const VERDICTS: readonly ReportVerdict[] = ['agree', 'disagree', 'abstain'];

export async function judge(request: Request<'judge'>, turn: Turn): Promise<AgentReply> {
  const note = noter(turn);
  try {
    const answer = await turn.model.ask(
      {
        system: judgeSystem(request, turn.persona, request.report),
        user: judgeUser(request),
        name: 'judge',
        schema: JUDGE_SCHEMA,
        temperature: turn.persona.temperature,
      },
      turn.signal,
    );
    const verdict = VERDICTS.includes(answer.verdict as ReportVerdict) ? (answer.verdict as ReportVerdict) : 'abstain';
    const reason = sentence(answer.reason);
    return { ok: true, kind: 'judge', verdict, reason, note: note(reason) };
  } catch (error) {
    return failure(error, note(), turn.signal);
  }
}

export async function comeback(request: Request<'comeback'>, turn: Turn): Promise<AgentReply> {
  const note = noter(turn);
  try {
    const answer = await turn.model.ask(
      {
        system: comebackSystem(request),
        user: comebackUser(request),
        name: 'comeback',
        schema: COMEBACK_SCHEMA,
        temperature: turn.persona.temperature,
      },
      turn.signal,
    );
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
