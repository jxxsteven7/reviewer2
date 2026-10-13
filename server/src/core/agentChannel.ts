import { connect } from 'node:net';
import { MAX_AGENT_REPLY, type AgentReply, type AgentRequest } from '@reviewer2/shared';
import { AGENT_REPLY } from '@reviewer2/shared/schemas';

// The way to the agent (docs/architecture.md#the-agent), a separate program that asks the language
// model for the AI players' moves: a Unix socket, one request on one line and one answer on one
// line, as with the mailer (accounts/mail.ts). The game server needs no network for it.

// What came of a request: the agent's answer, or why there was none: the agent couldn't be reached,
// didn't answer in time, or answered with something that isn't an answer. Only an answer that
// AGENT_REPLY takes in full comes through: the agent's word goes no further into the game than that.
export type AgentOutcome = AgentReply | { ok: false; error: 'unreachable' | 'timeout' | 'bad_reply' };

export interface AgentChannel {
  // Asks, and waits for the answer for up to `waitMs`, which the request also tells the agent, and a
  // moment more for the answer to arrive.
  ask(request: AgentRequest, waitMs: number): Promise<AgentOutcome>;
}

// The moment more that an answer may take on its way, after the agent has given up at waitMs.
const MARGIN_MS = 2_000;

export function socketAgent(path: string): AgentChannel {
  return {
    ask(request, waitMs) {
      return new Promise((resolve) => {
        let answer = '';
        let settled = false;
        const settle = (outcome: AgentOutcome) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(outcome);
        };
        const socket = connect(path, () => socket.write(`${JSON.stringify(request)}\n`));
        socket.setEncoding('utf8');
        socket.setTimeout(waitMs + MARGIN_MS, () => settle({ ok: false, error: 'timeout' }));
        socket.on('error', () => settle({ ok: false, error: 'unreachable' }));
        socket.on('data', (chunk: string) => {
          answer += chunk;
          if (Buffer.byteLength(answer) > MAX_AGENT_REPLY + 1) settle({ ok: false, error: 'bad_reply' });
        });
        socket.on('close', () => {
          let value: unknown;
          try {
            value = JSON.parse(answer);
          } catch {
            // No answer, or not one that can be read.
          }
          const parsed = AGENT_REPLY.safeParse(value);
          settle(parsed.success ? (parsed.data as AgentReply) : { ok: false, error: 'bad_reply' });
        });
      });
    },
  };
}
