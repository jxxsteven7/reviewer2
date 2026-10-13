import { log } from './log';
import { main } from './main';

// Node writes its warnings to stderr as plain text. The log is one JSON object a line (log.ts), so
// warnings go to it as such instead. Node puts a warning out a tick after it was raised, so this is
// in place before any that loading the modules above raised comes out.
process.removeAllListeners('warning');
process.on('warning', (warning) => log('warning', { name: warning.name, message: warning.message }));

// Starts the server (main.ts). Whatever keeps it from starting, such as a setting that is wrong,
// a word library without a list or a database that can't be opened, is logged on one line, and
// the process ends with 1.
main().catch((error: unknown) => {
  log('startup_failed', {
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  });
  process.exit(1);
});
