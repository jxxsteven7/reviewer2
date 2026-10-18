import { createHash } from 'node:crypto';
import type { MailRequest } from '@reviewer2/shared';
import type { Mail } from './templates';

// How a mail leaves: through Resend's HTTPS API, or, for development and tests, printed as one line
// of JSON, without a mail service. Each says whether the mail was taken.

export interface Transport {
  send(request: MailRequest, mail: Mail): Promise<boolean>;
}

type Log = (event: string, fields?: Record<string, unknown>) => void;

const RESEND = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export function resendTransport(apiKey: string, from: string, log: Log, fetchMail: typeof fetch = fetch): Transport {
  return {
    async send(request, { subject, text, html }) {
      try {
        const response = await fetchMail(RESEND, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // The same mail is sent once, should the request be repeated.
            'Idempotency-Key': `${request.kind}-${createHash('sha256').update(request.token).digest('hex')}`,
          },
          body: JSON.stringify({ from, to: [request.to], subject, text, html }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // The body of an error names the address, which stays out of the log.
        if (!response.ok) log('mail_failed', { kind: request.kind, status: response.status });
        return response.ok;
      } catch (error) {
        log('mail_failed', { kind: request.kind, message: error instanceof Error ? error.message : String(error) });
        return false;
      }
    },
  };
}

// Writes each mail as a line of JSON, its link included, to stdout and, when it is given, to a file
// that tests read the links from.
export function printTransport(write: (line: string) => void): Transport {
  return {
    send(request, mail) {
      write(JSON.stringify({ kind: request.kind, to: request.to, language: request.language, ...mail }));
      return Promise.resolve(true);
    },
  };
}
