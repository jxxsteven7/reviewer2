import { loadConfig } from './config';
import { log } from './log';
import { createAppServer } from './server';

const config = loadConfig();
const server = createAppServer(config);

server.http.listen(config.port, config.host, () => {
  log('listening', { host: config.host, port: config.port, version: config.version });
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log('stopping', { signal });
    // Give open connections a moment to close, then go regardless.
    setTimeout(() => process.exit(0), 5_000).unref();
    void server.close().then(() => process.exit(0));
  });
}
