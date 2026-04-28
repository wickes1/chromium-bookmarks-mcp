/**
 * Thin wrapper around Windows reg.exe for native-messaging registration.
 * Throws on failure with the underlying stderr included in the message.
 */
import { execFileSync } from 'node:child_process';

function runReg(args: string[]): string {
  try {
    return execFileSync('reg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message: string };
    const stderr = e.stderr ? e.stderr.toString() : '';
    throw new Error(`reg ${args.join(' ')} failed: ${stderr || e.message}`);
  }
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
    // reg.exe exits non-zero when the key doesn't exist; treat as no-op.
    const msg = (err as Error).message;
    if (/cannot find|not find|找不到/i.test(msg)) return;
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
    const msg = (err as Error).message;
    if (/cannot find|not find|找不到/i.test(msg)) return null;
    throw err;
  }
}
