import { describe, expect, test, afterAll, afterEach, beforeEach } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildManifestForTest,
  PUBLISHED_EXTENSION_ID,
  ensureRegistered,
  ensureRegisteredWith,
  register,
  getNativeHostPathForTest,
} from './register.js';
import { NATIVE_HOST_NAME } from './types.js';

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

describe('ensureRegistered idempotency (TEST-4)', () => {
  const filename = `${NATIVE_HOST_NAME}.json`;
  const expectedPath = '/opt/app/bin/run_host.sh';
  let tmp: string;
  let browserDir: string;
  let manifestPath: string;
  let registerCalls: number;

  function deps(overrides?: Partial<Parameters<typeof ensureRegisteredWith>[0]>) {
    return {
      browsers: [{ nativeHostDir: browserDir }],
      expectedPath,
      fileExists: existsSync,
      readFile: (p: string) => readFileSync(p, 'utf-8'),
      regRead: () => null,
      doRegister: () => {
        registerCalls += 1;
      },
      ...overrides,
    };
  }

  function seedManifest(pathValue: string): void {
    writeFileSync(manifestPath, JSON.stringify({ name: NATIVE_HOST_NAME, path: pathValue }), 'utf-8');
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cbm-register-'));
    browserDir = join(tmp, 'NativeMessagingHosts');
    mkdirSync(browserDir, { recursive: true });
    manifestPath = join(browserDir, filename);
    registerCalls = 0;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('no write when the manifest is present and path is current', () => {
    seedManifest(expectedPath);
    ensureRegisteredWith(deps());
    expect(registerCalls).toBe(0);
  });

  test('re-registers when the manifest is missing', () => {
    // manifest file not created
    ensureRegisteredWith(deps());
    expect(registerCalls).toBe(1);
  });

  test('re-registers when the manifest path is stale', () => {
    seedManifest('/old/stale/path/run_host.sh');
    ensureRegisteredWith(deps());
    expect(registerCalls).toBe(1);
  });

  test('re-registers when the manifest JSON is corrupt', () => {
    writeFileSync(manifestPath, '{ not json', 'utf-8');
    ensureRegisteredWith(deps());
    expect(registerCalls).toBe(1);
  });

  test('early-returns (no register) when no browsers are detected', () => {
    ensureRegisteredWith(deps({ browsers: [] }));
    expect(registerCalls).toBe(0);
  });

  test('the production ensureRegistered wrapper is callable with no args', () => {
    expect(typeof ensureRegistered).toBe('function');
    // Zero-arg public signature keeps existing callers (stdio-proxy) working.
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
