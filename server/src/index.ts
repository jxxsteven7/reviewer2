import { loadConfig } from './config';
import { loadWordLibrary } from './core/words';
import { keywordsGame } from './games/keywords';
import { log } from './log';
import { createAppServer } from './server';

const config = loadConfig();
const words = loadWordLibrary(config.wordsDir, (file, reason, term) =>
  log(term === undefined ? 'word_list_skipped' : 'term_skipped', { file, term, reason }),
);
log('word_lists_loaded', { fields: words.fields().map(({ id, counts }) => ({ id, ...counts })) });

const server = createAppServer({ ...config, words, games: [keywordsGame] });

server.http.listen(config.port, config.host, () => {
  log('listening', {
    host: config.host,
    port: config.port,
    version: config.version,
    trustProxy: config.trustProxy,
    roomsPerMinute: config.roomsPerMinute,
  });
});

// Closes idle rooms, drops long-gone players from waiting rooms and passes on absent chairs.
setInterval(() => server.sockets.sweep(), 60_000).unref();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log('stopping', { signal, rooms: server.rooms.size });
    // Give open connections a moment to close, then go regardless.
    setTimeout(() => process.exit(0), 5_000).unref();
    void server.stop().then(() => process.exit(0));
  });
}
