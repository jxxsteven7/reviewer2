// Errors that the client reports itself, on top of the codes the server sends.
export const CLIENT_ERRORS = [
  'offline',
  'timeout',
  'unknown',
  'cookies_blocked',
  'avatar_unreadable',
  'too_many_connections',
] as const;

// Whether an error says only that the page has no connection: none at all, or none that the server
// would take, as too busy or from an address with too many open (socket.ts). Whatever waits for a
// connection after the one waits after any of them.
export const unconnected = (code: string): boolean =>
  code === 'offline' || code === 'server_busy' || code === 'too_many_connections';

// The locale key that explains an error code. Every code has one (locales.test.ts checks).
export const errorKey = (code: string): string => `errors.${code}`;
