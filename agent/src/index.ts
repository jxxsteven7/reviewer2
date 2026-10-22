import { chmodSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { createAgent } from './agent';
import { loadConfig } from './config';
import { createModel } from './model';

// The agent (docs/architecture.md#the-agent): it plays for the AI players of the game server, which
// needs no access to the language model or the network for it. Started by systemd from its socket,
// it gets that socket as file descriptor 3; otherwise, as in development, it listens on
// AGENT_SOCKET. It logs one JSON object a line, as the game server does.

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

try {
  const config = loadConfig(process.env, process.pid);
  const model = createModel({ url: config.modelUrl, model: config.model, key: config.modelKey });
  // A game with a model of its own plays with it (config.ts).
  const models = Object.fromEntries(
    Object.entries(config.models).map(([game, own]) => [
      game,
      createModel({ url: own.modelUrl, model: own.model, key: own.modelKey }),
    ]),
  );
  const { server } = createAgent({ model, models, log, concurrency: config.concurrency, queue: config.queue });
  const listening = () =>
    log('agent_listening', {
      model: config.model,
      games: Object.fromEntries(Object.entries(config.models).map(([game, own]) => [game, own.model])),
      socket: config.activated ? 'fd 3' : config.socket,
    });
  if (config.activated) {
    server.listen({ fd: 3 }, listening);
  } else {
    const path = config.socket as string;
    mkdirSync(dirname(path), { recursive: true });
    // A socket that an agent before this one left behind.
    try {
      if (lstatSync(path).isSocket()) unlinkSync(path);
    } catch {
      // There was none.
    }
    server.listen(path, () => {
      // Only this user may ask it to play.
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
