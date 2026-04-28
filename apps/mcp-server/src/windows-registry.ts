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
 * reg.exe exits with status 1 when the key does not exist, regardless of
 * locale. Detect that case so callers can treat it as "no key" instead of
 * a hard error. Falls back to a regex on the localized message just in
 * case some shell wrapper swallows the exit code.
 */
function isKeyNotFoundError(err: unknown): boolean {
  const e = err as ExecError;
  if (e.status === 1) return true;
  return /unable to find|cannot find|not find|does not exist|找不到/i.test(e.message ?? '');
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

/** Read the (Default) value of a key, or return null if the key doesn't exist. */
export function regQuery(keyPath: string): string | null {
  try {
    const out = runReg(['query', keyPath, '/ve']);
    // Output looks like:
    //   <CRLF>
    //   <key>
    //       (Default)    REG_SZ    C:\path\to\manifest.json
    //   <CRLF>
    const match = out.match(/\(Default\)\s+REG_SZ\s+(.+?)\s*$/m);
    return match ? match[1] : null;
  } catch (err) {
    if (isKeyNotFoundError(err)) return null;
    throw err;
  }
}
