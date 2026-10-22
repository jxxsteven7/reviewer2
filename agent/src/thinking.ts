import { MAX_AGENT_THINKING, type AgentNote } from '@reviewer2/shared';
import type { Turn } from './keywords';
import { ModelError, type Question } from './model';

// How the agent lets the model think before it answers (docs/architecture.md#the-agent). Thinking
// makes for better moves, but it takes long, and how long varies: from a few seconds to over a
// minute for a clue at the low level. So the model thinks only until a time that the move sets,
// which leaves time for what comes after it, and a model that is still thinking then, or that
// fails while it thinks, is asked again without thinking, which takes a second or two. A model
// whose level is off, or a move with too little time to think, goes without from the start.

// The least time worth thinking for: with less, the question goes without.
const MIN_THINKING_MS = 5_000;

// What a note says of the thinking that went into a move (AgentNote).
export type Thinking = Pick<AgentNote, 'reasoning' | 'fellBack' | 'thinking'>;

// What the model thought, cut to what a note keeps, without half a character at the end.
function kept(text: string): string {
  const cut = text.slice(0, MAX_AGENT_THINKING);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

// Asks a question that the model may think about until `by`, on the turn's clock, and gives back
// the JSON object of its answer with what the note says of the thinking. Throws as Model.ask does
// when the answer without thinking fails too, or when the turn's own wait runs out.
export async function askThinking(
  question: Question,
  by: number,
  turn: Turn,
): Promise<{ value: Record<string, unknown>; thinking: Thinking }> {
  const { model, signal } = turn;
  const budget = Math.min(by, turn.until) - turn.now();
  if (model.reasoning !== 'off' && budget >= MIN_THINKING_MS) {
    const cut = new AbortController();
    const timer = setTimeout(() => cut.abort(), budget);
    try {
      const answer = await model.ask({ ...question, think: true }, AbortSignal.any([signal, cut.signal]));
      const thinking = answer.thinking === null ? {} : { thinking: kept(answer.thinking) };
      return { value: answer.value, thinking: { reasoning: model.reasoning, ...thinking } };
    } catch (error) {
      if (signal.aborted || !(error instanceof ModelError)) throw error;
    } finally {
      clearTimeout(timer);
    }
    const { value } = await model.ask({ ...question, think: false }, signal);
    return { value, thinking: { reasoning: model.reasoning, fellBack: true } };
  }
  const { value } = await model.ask({ ...question, think: false }, signal);
  return { value, thinking: { reasoning: 'off' } };
}
