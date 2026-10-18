// Starts the bundled server, mailer and agent for the end-to-end tests, with a model that answers
// by rule (e2e/model.mjs); playwright.config.ts runs this file. The server gets exactly the settings
// below and nothing from the shell that runs the tests, such as a HOST or PUBLIC_DIR exported for
// testing on a phone, so whatever it reads and isn't set here has its default. Its log goes to a
// file, which helpers.ts reads after each test to fail the test on an error the server reported.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { MODEL, startModel } from './model.mjs';

const root = join(import.meta.dirname, '..');
const port = process.env.E2E_PORT;
const log = process.env.E2E_SERVER_LOG;
const mails = process.env.E2E_MAIL_LOG;
const data = process.env.E2E_DATA_DIR;
const content = process.env.E2E_CONTENT_DIR;
if (!port || !log || !mails || !data || !content) {
  throw new Error(
    'E2E_PORT, E2E_SERVER_LOG, E2E_MAIL_LOG, E2E_DATA_DIR and E2E_CONTENT_DIR must be set; playwright.config.ts sets them',
  );
}

mkdirSync(dirname(log), { recursive: true });
const file = createWriteStream(log);
// The server's data, so that the operator's command (server/dist/admin.cjs) can run on it in a
// test, and the directory of the lists of thanks, which a test writes to. A run starts with
// neither, so the directories go first, which is why they may only be ones under test-results: a
// directory that the shell named would go with them.
const results = join(root, 'test-results');
for (const [name, dir] of [
  ['E2E_DATA_DIR', data],
  ['E2E_CONTENT_DIR', content],
]) {
  if (!resolve(dir).startsWith(results + sep)) {
    throw new Error(`${name} must be a directory under ${results}, not ${dir}`);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// The sockets of the mailer and the agent, in a directory of their own under the system's
// temporary one: a socket's path can have 107 bytes at most, which test-results would go over in a
// checkout deep in the file system.
const sockets = mkdtempSync(join(tmpdir(), 'reviewer2-e2e-'));
// Removed however this process ends, a failed start included.
process.on('exit', () => rmSync(sockets, { recursive: true, force: true }));

// The mailer, which writes the mails out to a file that helpers.ts reads the links from, rather
// than send them.
const socket = join(sockets, 'mailer.sock');
const mailer = spawn(process.execPath, [join(root, 'mailer', 'dist', 'mailer.cjs')], {
  cwd: root,
  env: {
    MAILER_TRANSPORT: 'print',
    MAILER_SOCKET: socket,
    MAILER_PRINT_FILE: mails,
    MAILER_BASE_URL: `http://127.0.0.1:${port}`,
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let tries = 0; !existsSync(socket); tries += 1) {
  if (tries > 100) throw new Error('the mailer did not start');
  await new Promise((resolve) => setTimeout(resolve, 50));
}

// The agent, which plays for the AI players, with the model of the tests on the next port.
const model = await startModel(Number(port) + 1);
const agentSocket = join(sockets, 'agent.sock');
const agent = spawn(process.execPath, [join(root, 'agent', 'dist', 'agent.cjs')], {
  cwd: root,
  env: {
    AGENT_SOCKET: agentSocket,
    AGENT_MODEL_URL: `http://127.0.0.1:${Number(port) + 1}/v1`,
    AGENT_MODEL: MODEL,
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let tries = 0; !existsSync(agentSocket); tries += 1) {
  if (tries > 100) throw new Error('the agent did not start');
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const server = spawn(process.execPath, [join(root, 'server', 'dist', 'index.cjs')], {
  cwd: root,
  env: {
    HOST: '127.0.0.1',
    PORT: port,
    PUBLIC_DIR: join(root, 'client', 'dist'),
    WORDS_DIR: join(root, 'words'),
    DATA_DIR: data,
    // Empty until a test writes a list there, so the server shows the ones the build bundled.
    CONTENT_DIR: content,
    TRUST_PROXY: '0',
    // Every test makes a room from the same address, and every browser sends its feedback and
    // registers its accounts from it.
    ROOMS_PER_MINUTE: '1000',
    FEEDBACK_PER_10_MINUTES: '1000',
    ACCOUNTS_PER_HOUR: '1000',
    // The tests run over plain HTTP, where WebKit drops a Secure cookie.
    COOKIE_SECURE: '0',
    SERVER_SECRET: 'end-to-end-tests-only-'.repeat(2),
    MAILER_SOCKET: socket,
    AGENT_SOCKET: agentSocket,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.pipe(file, { end: false });
server.stderr.pipe(file, { end: false });
// A crash shows in the test output as well.
server.stderr.pipe(process.stderr);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.kill(signal);
    mailer.kill(signal);
    agent.kill(signal);
    model.close();
  });
}
server.on('close', (code) => {
  mailer.kill();
  agent.kill();
  model.close();
  file.end();
  process.exitCode = code ?? 0;
});
