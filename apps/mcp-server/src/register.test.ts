import { describe, expect, test } from 'bun:test';
import { buildManifestForTest, PUBLISHED_EXTENSION_ID } from './register.js';

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
