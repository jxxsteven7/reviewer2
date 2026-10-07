// Errors that the client reports itself, on top of the codes the server sends.
export const CLIENT_ERRORS = ['offline', 'timeout', 'unknown'] as const;

// The locale key that explains an error code. Every code has one (locales.test.ts checks).
export const errorKey = (code: string): string => `errors.${code}`;
