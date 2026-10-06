import { loadConfig } from './config';
import { loadWordLibrary } from './core/words';
import { log } from './log';
import { createAppServer } from './server';

const config = loadConfig();
const words = loadWordLibrary(config.wordsDir, (file, reason, term) =>
  log(term === undefined ? 'word_list_skipped' : 'term_skipped', { file, term, reason }),
);
log('word_lists_loaded', { fields: words.fields().map(({ id, counts }) => ({ id, ...counts })) });
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
