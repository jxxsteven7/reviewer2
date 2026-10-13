// The language model, through OpenAI's chat completions, which most services that run models
// answer, Ollama and vLLM among them, as do the companies that rent theirs out. The agent asks it
// one question at a time and wants JSON back, in the shape of a schema it gives.
//
// Two fields keep the answer short and in shape. `response_format` with a JSON schema makes the
// model answer in that shape. `reasoning_effort: 'none'` turns off the long hidden reasoning that
// models which can think do before they answer: a game can't wait for it, and measured on Ollama's
// endpoint, it cuts the answer to a clue from about 400 tokens to about 20. Ollama's own
// `think: false` is ignored on this endpoint.

export interface ModelOptions {
  // As AgentConfig has them (config.ts).
  url: string;
  model: string;
  key: string | null;
  // The tests put in their own.
  fetch?: typeof fetch;
}

// One question: what the model is told it is and does, what it is asked, the schema of its
// answer under a name, and how freely it may choose its words, from 0 to 2.
export interface Question {
  system: string;
  user: string;
  name: string;
  schema: object;
  temperature: number;
}

export interface Model {
  // The model's name, which every answer of the agent notes (AgentNote).
  readonly name: string;
  // The answer, as the JSON object that the model wrote. Throws ModelError when there is none:
  // the service refused or couldn't be reached, the signal ran out, or the model wrote something
  // that isn't a JSON object.
  ask(question: Question, signal: AbortSignal): Promise<Record<string, unknown>>;
  // Whether the service is there and has the model. It only lists the models, which costs the
  // service nothing and doesn't load the model, so a ping says that the model can be asked, not
  // how long its first answer will take.
  ping(signal: AbortSignal): Promise<boolean>;
}

// Why the model gave no answer: its service couldn't be reached, or refused the request (`service`),
// which the server takes as the model being down; or it answered with something that isn't an
// answer, which says nothing of the next request.
export class ModelError extends Error {
  constructor(
    message: string,
    readonly service = false,
  ) {
    super(message);
  }
}

// The longest answer the model may write, in tokens. An answer is a few candidates or a few card
// numbers with a sentence; this only stops a model that has lost its way from writing on until the
// request's time runs out.
const MAX_TOKENS = 600;

export function createModel(options: ModelOptions): Model {
  const call = options.fetch ?? fetch;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.key !== null) headers.Authorization = `Bearer ${options.key}`;

  async function request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await call(`${options.url}${path}`, { ...init, headers });
    } catch (error) {
      throw new ModelError(error instanceof Error ? error.message : String(error), true);
    }
    if (!response.ok) throw new ModelError(`the model's service answered ${response.status}`, true);
    try {
      return await response.json();
    } catch {
      throw new ModelError("the model's service answered with something that isn't JSON");
    }
  }

  return {
    name: options.model,

    async ask(question, signal) {
      const body = await request('/chat/completions', {
        method: 'POST',
        signal,
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: 'system', content: question.system },
            { role: 'user', content: question.user },
          ],
          temperature: question.temperature,
          max_tokens: MAX_TOKENS,
          reasoning_effort: 'none',
          response_format: {
            type: 'json_schema',
            json_schema: { name: question.name, strict: true, schema: question.schema },
          },
        }),
      });
      const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message
        ?.content;
      if (typeof content !== 'string') throw new ModelError('the model gave no answer');
      let answer: unknown;
      try {
        answer = JSON.parse(content);
      } catch {
        throw new ModelError("the model's answer isn't JSON");
      }
      if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
        throw new ModelError("the model's answer isn't a JSON object");
      }
      return answer as Record<string, unknown>;
    },

    async ping(signal) {
      try {
        const body = await request('/models', { method: 'GET', signal });
        const models = (body as { data?: { id?: unknown }[] } | null)?.data;
        // Ollama lists a model that was pulled without a tag as "<name>:latest".
        return (
          Array.isArray(models) && models.some(({ id }) => id === options.model || id === `${options.model}:latest`)
        );
      } catch {
        return false;
      }
    },
  };
}
