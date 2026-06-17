import { describe, test, expect } from 'bun:test';
import { isBlockedHost } from '../entrypoints/background/handlers/read.js';

// handleCheckDeadLinks feeds the guard `new URL(bookmarkUrl).hostname`, so the
// realistic inputs are already canonicalized by the WHATWG URL parser.
function hostOf(url: string): string {
  return new URL(url).hostname;
}

describe('isBlockedHost (SSRF guard)', () => {
  // Raw host literals that must be blocked.
  const blocked = [
    'localhost',
    'localhost.',            // SEC-7b: absolute FQDN (trailing dot)
    'localhost.localdomain',
    'foo.localhost',
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',       // link-local + cloud metadata
    '0.0.0.0',
    '256.256.256.256',       // malformed dotted-quad -> block
    '::1',
    '[::1]',                 // bracketed IPv6 literal
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:7f00:1',         // SEC-7a: hex-compressed IPv4-mapped loopback
    '::ffff:127.0.0.1',      // dotted IPv4-mapped loopback
    '::ffff:a9fe:a9fe',      // IPv4-mapped 169.254.169.254
  ];
  for (const h of blocked) {
    test(`blocks ${h}`, () => expect(isBlockedHost(h)).toBe(true));
  }

  // Public hosts must NOT be blocked.
  const allowed = ['example.com', 'github.com', '8.8.8.8', '1.1.1.1', '93.184.216.34'];
  for (const h of allowed) {
    test(`allows ${h}`, () => expect(isBlockedHost(h)).toBe(false));
  }

  // The real call path: the URL parser canonicalizes encodings before the guard
  // ever runs, so these must all resolve to a blocked host.
  const blockedUrls = [
    'http://[::ffff:127.0.0.1]/',          // hostname -> [::ffff:7f00:1] (SEC-7a)
    'http://localhost./',                  // hostname -> localhost. (SEC-7b)
    'http://127.0.0.1/',
    'http://2130706433/',                  // decimal 127.0.0.1
    'http://0x7f000001/',                  // hex 127.0.0.1
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
  ];
  for (const u of blockedUrls) {
    test(`blocks via URL ${u}`, () => expect(isBlockedHost(hostOf(u))).toBe(true));
  }
});
