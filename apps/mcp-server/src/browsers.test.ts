import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { getBrowserCandidates, getInstalledBrowsers } from './browsers.js';
import type { BrowserEnv } from './browsers.js';

const HOME = '/home/tester';
const WIN_HOME = 'C:\\Users\\tester';

/** Build a BrowserEnv whose existsSync returns true only for the given exact paths. */
function envWith(opts: {
  os: NodeJS.Platform;
  home?: string;
  localAppData?: string;
  present?: string[];
}): BrowserEnv {
  const present = new Set(opts.present ?? []);
  return {
    platform: () => opts.os,
    homedir: () => opts.home ?? HOME,
    existsSync: (p: string) => present.has(p),
    localAppData: opts.localAppData,
  };
}

describe('getBrowserCandidates path sets', () => {
  test('macOS (darwin) candidate dirs', () => {
    const names = getBrowserCandidates(envWith({ os: 'darwin' }));
    const base = join(HOME, 'Library', 'Application Support');
    expect(names.map((b) => b.name)).toEqual(['Chrome', 'Brave', 'Edge', 'Arc', 'Chromium']);
    expect(names.find((b) => b.name === 'Chrome')!.nativeHostDir).toBe(
      join(base, 'Google', 'Chrome', 'NativeMessagingHosts'),
    );
    expect(names.find((b) => b.name === 'Arc')!.nativeHostDir).toBe(
      join(base, 'Arc', 'User Data', 'NativeMessagingHosts'),
    );
    // No Windows registry parent off-Windows.
    expect(names.every((b) => b.windowsRegistryParent === undefined)).toBe(true);
  });

  test('linux candidate dirs', () => {
    const names = getBrowserCandidates(envWith({ os: 'linux' }));
    expect(names.map((b) => b.name)).toEqual(['Chrome', 'Brave', 'Edge', 'Chromium']);
    expect(names.find((b) => b.name === 'Chrome')!.nativeHostDir).toBe(
      join(HOME, '.config', 'google-chrome', 'NativeMessagingHosts'),
    );
    expect(names.find((b) => b.name === 'Brave')!.nativeHostDir).toBe(
      join(HOME, '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
    );
  });

  test('windows candidate dirs use LOCALAPPDATA override and carry registry parents', () => {
    const localAppData = 'D:\\Custom\\Local';
    const names = getBrowserCandidates(
      envWith({ os: 'win32', home: WIN_HOME, localAppData }),
    );
    expect(names.map((b) => b.name)).toEqual(['Chrome', 'Brave', 'Edge']);
    expect(names.find((b) => b.name === 'Chrome')!.nativeHostDir).toBe(
      join(localAppData, 'Google', 'Chrome', 'User Data', 'NativeMessagingHosts'),
    );
    expect(names.find((b) => b.name === 'Chrome')!.windowsRegistryParent).toBe('Google\\Chrome');
    expect(names.find((b) => b.name === 'Edge')!.windowsRegistryParent).toBe('Microsoft\\Edge');
  });

  test('windows falls back to home\\AppData\\Local when LOCALAPPDATA is unset', () => {
    const names = getBrowserCandidates(
      envWith({ os: 'win32', home: WIN_HOME, localAppData: undefined }),
    );
    const fallback = join(WIN_HOME, 'AppData', 'Local');
    expect(names.find((b) => b.name === 'Chrome')!.nativeHostDir).toBe(
      join(fallback, 'Google', 'Chrome', 'User Data', 'NativeMessagingHosts'),
    );
  });

  test('unsupported platform yields no candidates', () => {
    expect(getBrowserCandidates(envWith({ os: 'aix' as NodeJS.Platform }))).toEqual([]);
  });
});

describe('getInstalledBrowsers existence filter', () => {
  const base = join(HOME, 'Library', 'Application Support');
  const chromeRoot = join(base, 'Google', 'Chrome');
  const chromeNmh = join(chromeRoot, 'NativeMessagingHosts');

  test('parent dir alone is NOT enough — requires a real profile marker', () => {
    // Only the profile-root parent exists, no Local State / Default marker.
    const env = envWith({ os: 'darwin', present: [chromeRoot] });
    expect(getInstalledBrowsers(env).map((b) => b.name)).toEqual([]);
  });

  test('Local State marker in the profile root counts as installed', () => {
    const env = envWith({
      os: 'darwin',
      present: [chromeRoot, join(chromeRoot, 'Local State')],
    });
    expect(getInstalledBrowsers(env).map((b) => b.name)).toEqual(['Chrome']);
  });

  test('Default profile dir marker counts as installed', () => {
    const env = envWith({
      os: 'darwin',
      present: [chromeRoot, join(chromeRoot, 'Default')],
    });
    expect(getInstalledBrowsers(env).map((b) => b.name)).toEqual(['Chrome']);
  });

  test('only browsers with a marker pass; others are filtered out', () => {
    const braveRoot = join(base, 'BraveSoftware', 'Brave-Browser');
    const env = envWith({
      os: 'darwin',
      present: [
        chromeRoot,
        join(chromeRoot, 'Default'),
        // Brave parent present but no marker -> excluded.
        braveRoot,
      ],
    });
    expect(getInstalledBrowsers(env).map((b) => b.name)).toEqual(['Chrome']);
  });

  test('nativeHostDir of a detected browser is preserved through the filter', () => {
    const env = envWith({
      os: 'darwin',
      present: [chromeRoot, join(chromeRoot, 'Local State')],
    });
    expect(getInstalledBrowsers(env)[0]!.nativeHostDir).toBe(chromeNmh);
  });
});
