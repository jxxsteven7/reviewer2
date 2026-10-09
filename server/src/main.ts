import { createServer, type Server as HttpServer } from 'node:http';
import { basename } from 'node:path';
import { fingerprintKey } from './accounts/email';
import { DEFAULT_ACCOUNT_LIMITS } from './accounts/limits';
import { socketMail } from './accounts/mail';
import { Accounts } from './accounts/service';
import { loadConfig } from './config';
import { DEFAULT_SOCKET_LIMITS } from './core/socket';
import { loadWordLibrary } from './core/words';
import { keywordsGame } from './games/keywords';
import { log as defaultLog } from './log';
import { createAppServer, type AppServer } from './server';
import { History, watchStats } from './stats';
import { createStatusHandler, STATUS_HOST } from './status';
import { openDatabase, truncateWal } from './store/database';
import { FeedbackStore } from './store/feedback';
import { SNAPSHOT_MS, Snapshots } from './store/snapshots';

// Starts the server and stops it (docs/architecture.md): the settings, the word library, the
// database, the game's port, the timers and the status page, and on SIGTERM or SIGINT all of it
// again in reverse. index.ts runs it; tests run it with an environment, a log and an exit of their
// own.

type Log = (event: string, fields?: Record<string, unknown>) => void;

export interface MainOptions {
  env?: NodeJS.ProcessEnv;
  log?: Log;
  // Ends the process. Tests give it one that only records the code.
  exit?: (code: number) => void;
  // Whether SIGTERM and SIGINT stop the server. Tests stop it themselves.
  signals?: boolean;
  // How long stopping may take before the process ends regardless.
  stopMs?: number;
  // How often contacts are cleared and a snapshot is taken: every hour, unless a test says
  // otherwise.
  housekeepingMs?: number;
}

export interface Running {
  server: AppServer;
  feedback: FeedbackStore;
  accounts: Accounts;
  // Stops the server, closes the database and ends the process: with 0 when all of that went
  // well, and with 1 when it failed or took too long.
  stop(signal: string): Promise<void>;
}

export const STOP_MS = 5_000;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Starts everything, and resolves once the game's port is open. Throws when the server can't
// start at all: for a setting that is wrong, a word library or a database that can't be used.
// When the port can't be opened, the process ends with 1 and this resolves with null.
export async function main({
  env = process.env,
  log = defaultLog,
  exit = (code) => process.exit(code),
  signals = true,
  stopMs = STOP_MS,
  housekeepingMs = SNAPSHOT_MS,
}: MainOptions = {}): Promise<Running | null> {
  const config = loadConfig(env);
  const words = loadWordLibrary(config.wordsDir, (file, reason, term) =>
    log(term === undefined ? 'word_list_skipped' : 'term_skipped', { file, term, reason }),
  );
  log('word_lists_loaded', { fields: words.fields().map(({ id, counts }) => ({ id, ...counts })) });

  const database = await openDatabase(config.dataDir, { log });
  const { db } = database;
  if (database.file === null) {
    log('database_opened', {
      storage: 'memory',
      note: 'everything in it is lost when the server stops; set DATA_DIR to keep it',
    });
  } else {
    log('database_opened', {
      storage: 'file',
      file: database.file,
      journal: database.journal,
      schema: database.schema,
    });
    if (database.migratedFrom !== null) {
      const snapshot = database.beforeMigration === null ? null : basename(database.beforeMigration);
      log('database_migrated', { from: database.migratedFrom, to: database.schema, snapshot });
    }
  }
  const feedback = new FeedbackStore(db);
  const snapshots = database.snapshots === null ? null : new Snapshots(db, database.snapshots, log);

  // Secure delete overwrites what is deleted in the database file, such as a contact that has been
  // kept for 90 days or an account, but the WAL beside it still holds the pages as they were
  // before, until a checkpoint writes them back and a truncation drops them. That can't be done
  // while another connection is in the middle of the database, so it is tried again every hour
  // until it is, with the contacts, and the log says each time whether it was.
  let walHoldsDeleted = false;
  const dropFromWal = (): boolean => {
    walHoldsDeleted = !truncateWal(db);
    return !walHoldsDeleted;
  };
  const clearContacts = () => {
    const count = feedback.clearContacts();
    if (count === 0 && !walHoldsDeleted) return;
    log('contacts_cleared', { count, walTruncated: dropFromWal() });
  };

  const { accountsPerHour } = config;
  if (accountsPerHour > DEFAULT_ACCOUNT_LIMITS.registrationsPerHour) {
    log('accounts_per_hour_raised', { accountsPerHour, default: DEFAULT_ACCOUNT_LIMITS.registrationsPerHour });
  }
  const accounts = new Accounts({
    db,
    now: () => performance.now(),
    log,
    limits: { ...DEFAULT_ACCOUNT_LIMITS, registrationsPerHour: accountsPerHour },
    deleted: () => {
      walHoldsDeleted = true;
      dropFromWal();
    },
    fingerprintKey: config.secret === null ? null : fingerprintKey(config.secret),
    mail: config.mailerSocket === null ? null : socketMail(config.mailerSocket),
  });

  let server: AppServer;
  try {
    clearContacts();
    accounts.prune();
    server = createAppServer({
      ...config,
      words,
      games: [keywordsGame],
      feedback,
      accounts,
      socketLimits: {
        ...DEFAULT_SOCKET_LIMITS,
        roomsPerMinute: config.roomsPerMinute,
        feedbackPerWindow: config.feedbackPerWindow,
      },
      log,
    });
  } catch (error) {
    db.close();
    throw error;
  }

  // A port that can't be opened, because something else has it or because it needs privileges
  // that the server doesn't have, ends the process with one line that says so, rather than with
  // the stack of an 'error' event that nobody handled.
  const listening = await new Promise<boolean>((resolve) => {
    const failed = (error: NodeJS.ErrnoException) => {
      log('listen_failed', { host: config.host, port: config.port, code: error.code, message: error.message });
      resolve(false);
    };
    server.http.once('error', failed);
    server.http.listen(config.port, config.host, () => {
      server.http.off('error', failed);
      log('listening', {
        host: config.host,
        port: config.port,
        version: config.version,
        trustProxy: config.trustProxy,
        roomsPerMinute: config.roomsPerMinute,
        feedbackPer10Minutes: config.feedbackPerWindow,
        accountsPerHour,
        cookieSecure: config.cookieSecure,
        // Email for accounts needs both the server's secret and the mailer.
        mail: accounts.mailAvailable,
      });
      resolve(true);
    });
  });
  if (!listening) {
    await server.close();
    db.close();
    exit(1);
    return null;
  }

  const timers = [
    // Closes idle rooms, drops long-gone players from waiting rooms and passes on absent chairs,
    // and forgets the counts of the limits whose time has run out.
    setInterval(() => {
      server.sockets.sweep();
      accounts.counters.prune();
    }, 60_000),
    // Every hour, the contacts that have been kept for 90 days are cleared, the logins and the
    // links in mails that have ended are deleted, and then a snapshot is taken, so that no new
    // snapshot has them. None of it may end the process when it fails.
    setInterval(() => {
      try {
        clearContacts();
        accounts.prune();
      } catch (error) {
        log('error', { where: 'housekeeping', message: describe(error) });
      }
      void snapshots?.take();
    }, housekeepingMs),
  ];
  for (const timer of timers) timer.unref();
  // The first snapshot comes at once unless the latest is less than an hour old.
  if (snapshots?.due()) void snapshots.take();

  // The `stats` log line every 5 minutes, and the samples for the status page's chart, which are
  // only taken while there is a page to show them on.
  const { statusPort } = config;
  const history = statusPort === null ? null : new History();
  const stopStats = watchStats(server.stats, log, history);

  let status: HttpServer | null = null;
  if (statusPort !== null && history !== null) {
    const page = createServer(createStatusHandler(server.stats, history, feedback, log, () => accounts.store.count()));
    status = page;
    // The page is the operator's alone. A port that can't be opened, because something else has
    // it, is logged, and the game goes on without the page: the listen error would otherwise end
    // the process.
    page.on('error', (error) =>
      log('status_unavailable', { host: STATUS_HOST, port: statusPort, message: error.message }),
    );
    page.listen(statusPort, STATUS_HOST, () => log('status_listening', { host: STATUS_HOST, port: statusPort }));
  }

  // The process ends once, with the first code: a stop that finishes after it has timed out
  // changes nothing.
  let ended = false;
  const end = (code: number) => {
    if (ended) return;
    ended = true;
    exit(code);
  };

  let stopping: Promise<void> | null = null;
  const stop = (signal: string) =>
    (stopping ??= (async () => {
      log('stopping', { signal, rooms: server.rooms.size });
      // Give open connections a moment to close, then go regardless. Something didn't finish, so
      // the process ends with 1, and the next start finds the database as SQLite left it, which
      // WAL keeps whole.
      const timeout = setTimeout(() => {
        log('stop_timed_out', { ms: stopMs });
        end(1);
      }, stopMs);
      timeout.unref();
      for (const timer of timers) clearInterval(timer);
      stopStats();
      status?.close();
      let code = 0;
      try {
        await server.stop();
      } catch (error) {
        log('error', { where: 'stop', message: describe(error) });
        code = 1;
      }
      try {
        await snapshots?.idle();
        db.close();
      } catch (error) {
        log('error', { where: 'database', message: describe(error) });
        code = 1;
      }
      clearTimeout(timeout);
      end(code);
    })());

  if (signals) {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => void stop(signal));
  }
  return { server, feedback, accounts, stop };
}
