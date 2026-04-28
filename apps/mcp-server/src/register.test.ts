import { describe, expect, test, afterAll } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  buildManifestForTest,
  PUBLISHED_EXTENSION_ID,
  ensureRegistered,
  register,
  getNativeHostPathForTest,
} from './register.js';

describe('buildManifest', () => {
  test('defaults allowed_origins to the published Web Store extension ID', () => {
    const m = buildManifestForTest();
    expect(m.allowed_origins).toEqual([`chrome-extension://${PUBLISHED_EXTENSION_ID}/`]);
  });

  test('honours a CLI-supplied extension ID override', () => {
    const overrideId = 'abcdefghijklmnopabcdefghijklmnop';
    const m = buildManifestForTest(overrideId);
    expect(m.allowed_origins).toEqual([`chrome-extension://${overrideId}/`]);
  });

  test('does not use the wildcard origin by default', () => {
    const m = buildManifestForTest();
    expect(m.allowed_origins).not.toContain('chrome-extension://*/');
  });
});

describe('ensureRegistered', () => {
  test('is exported and callable without arguments', () => {
    expect(typeof ensureRegistered).toBe('function');
    expect(ensureRegistered.length).toBe(0);
  });
});

describe('getNativeHostPath', () => {
  test('returns an absolute path that exists on disk', () => {
    const p = getNativeHostPathForTest();
    expect(p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)).toBe(true);
    expect(existsSync(p)).toBe(true);
  });
});

describe('register input validation', () => {
  test('rejects an extension ID that is not 32 chars', () => {
    expect(() => register('short')).toThrow(/Invalid extension ID/);
  });

  test('rejects an extension ID with characters outside a-p', () => {
    expect(() => register('z'.repeat(32))).toThrow(/Invalid extension ID/);
  });

  test('rejects uppercase letters', () => {
    expect(() => register('A'.repeat(32))).toThrow(/Invalid extension ID/);
  });
});

import { regAdd, regDelete, regQuery } from './windows-registry.js';

const onWindows = process.platform === 'win32';

(onWindows ? describe : describe.skip)('windows-registry wrapper', () => {
  const testKey = 'HKCU\\Software\\chromium-bookmarks-mcp-test\\__roundtrip';

  afterAll(() => {
    if (onWindows) {
      try { regDelete('HKCU\\Software\\chromium-bookmarks-mcp-test'); } catch {}
    }
  });

  test('regAdd, regQuery, regDelete round-trip', () => {
    const value = 'C:\\test\\path.json';
    regAdd(testKey, value);
    expect(regQuery(testKey)).toBe(value);
    regDelete(testKey);
    expect(regQuery(testKey)).toBeNull();
  });
});
