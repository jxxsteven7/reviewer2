import { admin } from './admin';

// Runs the operator's commands (admin.ts) and ends with their exit code: 0 when the command did
// what it says, 1 when it couldn't, and 2 when it wasn't one.
try {
  process.exitCode = admin(process.argv.slice(2), process.env, (line) => console.log(line));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
