import { appendFileSync, chmodSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from './config';
import { createMailer } from './mailer';
import { Quota } from './quota';
import { printTransport, resendTransport } from './transports';

// The mailer (docs/architecture.md): it sends the mails of accounts for the game server, which
// needs no access to the internet. Started by systemd from its socket, it gets that socket as
// file descriptor 3; otherwise, as in development, it listens on MAILER_SOCKET. It logs one JSON object a line,
// as the game server does.

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

try {
  const config = loadConfig(process.env, process.pid);
  const quota = new Quota(config.stateDir === null ? null : join(config.stateDir, 'sent.json'));
  const transport =
    config.transport === 'resend'
      ? resendTransport(config.apiKey as string, config.from, log)
      : printTransport((line) => {
          console.log(line);
          if (config.printFile) appendFileSync(config.printFile, `${line}\n`);
        });
  if (config.transport === 'print') log('mailer_prints', { note: 'no mail leaves; for development only' });
  const { server } = createMailer({ quota, transport, baseUrl: config.baseUrl, log });
  const listening = () =>
    log('mailer_listening', { transport: config.transport, socket: config.activated ? 'fd 3' : config.socket });
  if (config.activated) {
    server.listen({ fd: 3 }, listening);
  } else {
    const path = config.socket as string;
    mkdirSync(dirname(path), { recursive: true });
    // A socket that a mailer before this one left behind.
    try {
      if (lstatSync(path).isSocket()) unlinkSync(path);
    } catch {
      // There was none.
    }
    server.listen(path, () => {
      // Only this user may ask it for mail.
      chmodSync(path, 0o600);
      listening();
    });
  }
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
} catch (error) {
  log('startup_failed', { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
