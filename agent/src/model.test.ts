import { describe, expect, test } from 'vitest';
import { createModel, ModelError } from './model';

const question = { system: 'You play.', user: 'Board', name: 'clue', schema: { type: 'object' }, temperature: 0.6 };

// A fetch that answers every call with `answer`, and keeps what it was asked.
function service(answer: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const call = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer(url);
  }) as typeof fetch;
  return { calls, call };
}

const completion = (content: unknown) => Response.json({ choices: [{ message: { content } }] });

describe('the model', () => {
  test('is asked for JSON in the schema, without thinking first, with the key if there is one', async () => {
    const { calls, call } = service(() => completion('{"candidates":[]}'));
    const model = createModel({ url: 'http://model.test/v1', model: 'm', key: 'secret', fetch: call });
    expect(await model.ask(question, AbortSignal.timeout(1000))).toEqual({ candidates: [] });
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe('http://model.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'm',
      temperature: 0.6,
      reasoning_effort: 'none',
      response_format: { type: 'json_schema', json_schema: { name: 'clue', strict: true, schema: { type: 'object' } } },
    });
    expect(body.messages).toEqual([
      { role: 'system', content: 'You play.' },
      { role: 'user', content: 'Board' },
    ]);

    const keyless = service(() => completion('{}'));
    await createModel({ url: 'http://model.test/v1', model: 'm', key: null, fetch: keyless.call }).ask(
      question,
      AbortSignal.timeout(1000),
    );
    expect((keyless.calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test("gives no answer that isn't a JSON object", async () => {
    const answers = [
      () => new Response('down', { status: 503 }),
      () => new Response('not json'),
      () => Response.json({ choices: [] }),
      () => completion(42),
      () => completion('not json'),
      () => completion('[1, 2]'),
      () => completion('null'),
      () => Promise.reject(new TypeError('fetch failed')),
    ];
    for (const answer of answers) {
      const model = createModel({ url: 'http://model.test/v1', model: 'm', key: null, fetch: service(answer).call });
      await expect(model.ask(question, AbortSignal.timeout(1000))).rejects.toBeInstanceOf(ModelError);
    }
  });

  test('is there when the service lists it, under its name or as the latest of its name', async () => {
    const listing = (ids: string[]) => () => Response.json({ object: 'list', data: ids.map((id) => ({ id })) });
    const ping = (answer: () => Response | Promise<Response>, name = 'qwen') =>
      createModel({ url: 'http://model.test/v1', model: name, key: null, fetch: service(answer).call }).ping(
        AbortSignal.timeout(1000),
      );
    expect(await ping(listing(['other', 'qwen']))).toBe(true);
    expect(await ping(listing(['qwen:latest']))).toBe(true);
    expect(await ping(listing(['qwen2']))).toBe(false);
    expect(await ping(() => new Response('down', { status: 500 }))).toBe(false);
    expect(await ping(() => Promise.reject(new TypeError('fetch failed')))).toBe(false);
    const { calls, call } = service(listing(['qwen']));
    await createModel({ url: 'http://model.test/v1', model: 'qwen', key: null, fetch: call }).ping(
      AbortSignal.timeout(1000),
    );
    expect(calls[0]?.url).toBe('http://model.test/v1/models');
  });
});
