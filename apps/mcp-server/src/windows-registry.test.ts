/**
 * Pure-function tests for the reg.exe stdout parser and the not-found error
 * classifier. These use captured-output fixtures and depend on no Windows-only
 * binary, so they run on every CI leg (macOS / Linux / Windows), guarding the
 * exact parsing/classification logic ensureRegistered relies on.
 */
import { describe, test, expect } from 'bun:test';
import { parseRegQueryDefault, isKeyNotFoundError } from './windows-registry.js';

// reg.exe emits CRLF line endings and a whitespace-padded value column.
const CRLF = '\r\n';
function regOutput(valueLine: string): string {
  return [
    '',
    'HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.chromium_bookmarks_mcp',
    valueLine,
    '',
  ].join(CRLF);
}

describe('parseRegQueryDefault (TEST-6)', () => {
  test('parses a simple path value and strips the trailing CR', () => {
    const out = regOutput('    (Default)    REG_SZ    C:\\Users\\me\\manifest.json');
    expect(parseRegQueryDefault(out)).toBe('C:\\Users\\me\\manifest.json');
  });

  test('preserves interior spaces in a path with spaces (greedy capture)', () => {
    const out = regOutput('    (Default)    REG_SZ    C:\\Program Files\\My App\\host\\manifest.json');
    expect(parseRegQueryDefault(out)).toBe('C:\\Program Files\\My App\\host\\manifest.json');
  });

  test('trims trailing whitespace/padding the value column may carry', () => {
    const out = regOutput('    (Default)    REG_SZ    C:\\a\\b.json   ');
    expect(parseRegQueryDefault(out)).toBe('C:\\a\\b.json');
  });

  test('returns null when no (Default) REG_SZ row is present', () => {
    const out = [
      '',
      'HKEY_CURRENT_USER\\Software\\Foo',
      '    Something    REG_DWORD    0x1',
      '',
    ].join(CRLF);
    expect(parseRegQueryDefault(out)).toBeNull();
  });

  test('returns null for empty output', () => {
    expect(parseRegQueryDefault('')).toBeNull();
  });
});

describe('isKeyNotFoundError (TEST-6)', () => {
  test('status 1 with no access-denied message is treated as not found', () => {
    const err = Object.assign(new Error('reg query ... failed: '), { status: 1 });
    expect(isKeyNotFoundError(err)).toBe(true);
  });

  test('localized/English not-found message (no status) is treated as not found', () => {
    const err = new Error('ERROR: The system was unable to find the specified registry key or value.');
    expect(isKeyNotFoundError(err)).toBe(true);
  });

  test('access-denied is NOT swallowed as not found, even at status 1', () => {
    const err = Object.assign(new Error('reg query ... failed: ERROR: Access is denied.'), { status: 1 });
    expect(isKeyNotFoundError(err)).toBe(false);
  });

  test('a generic failure with no markers is not classified as not found', () => {
    const err = Object.assign(new Error('reg query ... failed: ERROR: Invalid syntax.'), { status: 2 });
    expect(isKeyNotFoundError(err)).toBe(false);
  });
});
