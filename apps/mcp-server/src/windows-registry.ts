/**
 * Thin wrapper around Windows reg.exe for native-messaging registration.
 * Throws on failure with the underlying stderr included in the message.
 */
import { execFileSync } from 'node:child_process';

interface ExecError extends Error {
  status?: number | null;
  stderr?: string | Buffer;
}

function runReg(args: string[]): string {
  try {
    return execFileSync('reg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
  } catch (err) {
    const e = err as ExecError;
    const stderr = e.stderr ? e.stderr.toString() : '';
    const wrapped = new Error(`reg ${args.join(' ')} failed: ${stderr || e.message}`) as ExecError;
    wrapped.status = e.status ?? null;
    wrapped.stderr = stderr;
    throw wrapped;
  }
}

/**
 * reg.exe exits with status 1 when the key does not exist. Access-denied and
 * other hard failures must NOT be misread as "no key", or a real registry
 * problem gets silently swallowed as null. So we require BOTH a status-1 exit
 * AND a message that does not look like an access/permission failure, and we
 * also accept a localized not-found message on its own in case a shell wrapper
 * swallowed the exit code. Exported for unit testing with captured fixtures.
 */
export function isKeyNotFoundError(err: unknown): boolean {
  const e = err as ExecError;
  const msg = e.message ?? '';
  // Access-denied is its own failure class, never "not found".
  if (/access is denied|access denied|permission denied|拒绝访问|拒絕存取/i.test(msg)) {
    return false;
  }
  const looksLikeNotFound =
    /unable to find|cannot find|not find|does not exist|找不到/i.test(msg);
  if (e.status === 1) return true;
  return looksLikeNotFound;
}

/**
 * Parse the (Default) value out of `reg query <key> /ve` stdout.
 *
 * Output looks like (CRLF line endings, value column is whitespace-padded):
 *   <CRLF>
 *   <key>
 *       (Default)    REG_SZ    C:\Program Files\path with spaces\manifest.json
 *   <CRLF>
 *
 * Greedy-capture everything after the `REG_SZ` column to the end of the line so
 * paths containing spaces survive intact, then trim a trailing CR/whitespace.
 * Returns null when no (Default) REG_SZ row is present. Exported for testing.
 */
export function parseRegQueryDefault(stdout: string): string | null {
  const match = stdout.match(/\(Default\)\s+REG_SZ\s+(.+)$/m);
  if (!match) return null;
  // `.+$` with multiline stops at \n but keeps a trailing \r; strip it + any
  // trailing padding the value column may carry.
  return match[1].replace(/[\s﻿]+$/, '');
}

/** Set the (Default) value of a registry key to the given string. Creates the key if missing. */
export function regAdd(keyPath: string, value: string): void {
  runReg(['add', keyPath, '/ve', '/d', value, '/t', 'REG_SZ', '/f']);
}

/** Delete a registry key (and its values) if present. No-op if it doesn't exist. */
export function regDelete(keyPath: string): void {
  try {
    runReg(['delete', keyPath, '/f']);
  } catch (err) {
    if (isKeyNotFoundError(err)) return;
    throw err;
  }
}

/**
 * Read the (Default) value of a key. Returns null only when the key genuinely
 * does not exist; any other failure (e.g. access denied) is re-thrown so it is
 * not silently swallowed as a missing key.
 */
export function regQuery(keyPath: string): string | null {
  try {
    const out = runReg(['query', keyPath, '/ve']);
    return parseRegQueryDefault(out);
  } catch (err) {
    if (isKeyNotFoundError(err)) return null;
    throw err;
  }
}
