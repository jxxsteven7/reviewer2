import { createServer, type Server, type Socket } from 'node:net';
import type { MailReply } from '@reviewer2/shared';
import { parseRequest } from './protocol';
import type { Quota } from './quota';
import { render } from './templates';
import type { Transport } from './transports';

// The mailer's work (docs/architecture.md): one request on one line of a connection, one answer
// on one line back, and then the connection closes. The log says what kind of mail was sent, in
// which language and how it went, and never to whom or with what secret.

type Log = (event: string, fields?: Record<string, unknown>) => void;

export interface MailerOptions {
  quota: Quota;
  transport: Transport;
  baseUrl: string;
  log: Log;
  // How long a connection has to send its request, and how long the request may be.
  readMs?: number;
  maxLine?: number;
}

export function createMailer({ quota, transport, baseUrl, log, readMs = 2_000, maxLine = 2048 }: MailerOptions) {
  async function handle(line: string): Promise<MailReply> {
    const request = parseRequest(line);
    if (!request) {
      log('mail_refused', { reason: 'bad_request' });
      return { ok: false, error: 'bad_request' };
    }
    const { kind, language } = request;
    if (!quota.take(kind)) {
      log('mail_refused', { reason: 'quota', kind });
      return { ok: false, error: 'quota' };
    }
    if (!(await transport.send(request, render(request, baseUrl)))) return { ok: false, error: 'failed' };
    log('mail_sent', { kind, language });
    return { ok: true };
  }

  // One request on one connection: what comes after its line is not read, so that the same request
  // can't be handled twice, as it would be if the line were found again in what came after it.
  function serve(socket: Socket): void {
    let received = '';
    let read = false;
    let answered = false;
    const answer = (reply: MailReply) => {
      if (answered) return;
      answered = true;
      socket.end(`${JSON.stringify(reply)}\n`);
    };
    socket.setEncoding('utf8');
    socket.setTimeout(readMs, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      if (read) return;
      received += chunk;
      const end = received.indexOf('\n');
      if (end === -1 && received.length <= maxLine) return;
      read = true;
      if (end === -1 || end > maxLine) {
        answer({ ok: false, error: 'bad_request' });
        return;
      }
      socket.setTimeout(0);
      handle(received.slice(0, end)).then(answer, (error: unknown) => {
        log('error', { message: error instanceof Error ? error.message : String(error) });
        answer({ ok: false, error: 'failed' });
      });
    });
  }

  const server: Server = createServer(serve);
  return { handle, server };
}
