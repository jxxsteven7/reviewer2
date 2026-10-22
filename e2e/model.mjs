// A language model for the end-to-end tests, which e2e/server.mjs starts: it answers OpenAI's chat
// completions as the agent asks them (agent/src/model.ts), by rule rather than by thought, so that
// the tests know what the AI players will do. As the PI it aims "zebra", or another clue that hasn't
// been given, at the first two cards of its group's that are face down. As a student it reveals a
// card that a test told it of with POST /e2e/picks, once, or else the first card that is face down,
// whose color it doesn't know; a test names the card by its word, with the words of its board, so
// that the rooms of tests that run at the same time, whose boards may share a word, keep apart. The
// PI's rehearsals of its clues, which the agent asks without thinking, while a student's guesses
// think, reveal the first card face down and leave the card a test told of to the student. Asked
// to think, it says what it thought, for the AI's log. It lists one model, `e2e-model`.
import { createServer } from 'node:http';

export const MODEL = 'e2e-model';

const CLUES = ['zebra', 'quokka', 'narwhal'];

// The cards that students are to reveal, as tests named them: the word, and the words of the board
// it is on.
const told = [];

// The cards of the board in the question, by number: "7. Word [OURS]", and " (revealed)" for one
// that is face up.
function cards(question) {
  const lines = question.matchAll(/^(\d+)\. (.*?)(?: \[[A-Z0-9 ]+\])?(?: \(revealed\))?$/gm);
  return [...lines].map(([line, number, word]) => ({
    number: Number(number),
    word,
    ours: line.includes('[OURS]'),
    revealed: line.endsWith('(revealed)'),
  }));
}

const thinks = (body) => body.reasoning_effort !== undefined && body.reasoning_effort !== 'none';

function answer(body) {
  const question = body.messages?.at(-1)?.content ?? '';
  const board = cards(question).filter((card) => !card.revealed);
  if (body.response_format?.json_schema?.name === 'clue') {
    const targets = board
      .filter((card) => card.ours)
      .slice(0, 2)
      .map((card) => card.number);
    // More than one clue, for when the first was given before in the game, which the agent refuses.
    return { candidates: CLUES.map((clue) => ({ targets, clue, count: targets.length })) };
  }
  const words = new Set(cards(question).map((card) => card.word));
  const place = thinks(body) ? told.findIndex((pick) => pick.board.every((word) => words.has(word))) : -1;
  const wanted = place === -1 ? undefined : board.find((card) => card.word === told[place].word);
  if (place !== -1) told.splice(place, 1);
  return { picks: [(wanted ?? board[0])?.number ?? 0], reason: 'It fits the clue.' };
}

export function startModel(port) {
  const server = createServer((request, response) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => {
      const reply = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (request.method === 'GET' && request.url === '/v1/models') return reply(200, { data: [{ id: MODEL }] });
      if (request.method === 'POST' && request.url === '/e2e/picks') {
        const { word, board } = JSON.parse(text);
        told.push({ word, board });
        return reply(200, {});
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') return reply(404, {});
      const body = JSON.parse(text);
      const content = JSON.stringify(answer(body));
      const reasoning = thinks(body) ? 'The rules of the end-to-end tests decide.' : undefined;
      reply(200, { choices: [{ message: { role: 'assistant', content, reasoning } }] });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
