import { createServer } from 'node:http';
import { loadConfig } from './config';
import { loadWordLibrary } from './core/words';
import { keywordsGame } from './games/keywords';
import { log } from './log';
import { createAppServer } from './server';
import { History, watchStats } from './stats';
import { createStatusHandler, STATUS_HOST } from './status';

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

// The `stats` log line every 5 minutes, and the samples for the status page's chart, which are
// only taken while there is a page to show them on.
const { statusPort } = config;
const history = statusPort === null ? null : new History();
watchStats(server.stats, log, history);

if (statusPort !== null && history !== null) {
  const status = createServer(createStatusHandler(server.stats, history, log));
  // The page is the operator's alone. A port that can't be opened, because something else has
  // it, is logged, and the game goes on without the page: the listen error would otherwise end
  // the process.
  status.on('error', (error) =>
    log('status_unavailable', { host: STATUS_HOST, port: statusPort, message: error.message }),
  );
  status.listen(statusPort, STATUS_HOST, () => log('status_listening', { host: STATUS_HOST, port: statusPort }));
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log('stopping', { signal, rooms: server.rooms.size });
    // Give open connections a moment to close, then go regardless.
    setTimeout(() => process.exit(0), 5_000).unref();
    void server.stop().then(() => process.exit(0));
  });
}
