import { connect } from 'node:net';
import type { MailReply, MailRequest } from '@reviewer2/shared';

// The way to the mailer (docs/architecture.md), a separate program that holds the key of the mail
// service: a Unix socket, one request on one line and one answer on one line. The game server
// needs no access to the internet for it: a socket on the file system works without a network.

export type MailOutcome = 'sent' | 'quota' | 'refused' | 'failed';

export interface MailChannel {
  send(request: MailRequest): Promise<MailOutcome>;
}

const TIMEOUT_MS = 15_000;

export function socketMail(path: string): MailChannel {
  return {
    send(request) {
      return new Promise((resolve) => {
        let answer = '';
        let settled = false;
        const settle = (outcome: MailOutcome) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(outcome);
        };
        const socket = connect(path, () => socket.write(`${JSON.stringify(request)}\n`));
        socket.setEncoding('utf8');
        // The mailer has up to 10 seconds to reach the mail service.
        socket.setTimeout(TIMEOUT_MS, () => settle('failed'));
        socket.on('error', () => settle('failed'));
        socket.on('data', (chunk: string) => {
          answer += chunk;
          if (answer.length > 1024) settle('failed');
        });
        socket.on('close', () => {
          let reply: MailReply | null = null;
          try {
            reply = JSON.parse(answer) as MailReply;
          } catch {
            // No answer, or not one that can be read.
          }
          if (reply?.ok === true) settle('sent');
          else if (reply?.ok === false && reply.error === 'quota') settle('quota');
          else if (reply?.ok === false && reply.error === 'bad_request') settle('refused');
          else settle('failed');
        });
      });
    },
  };
}
