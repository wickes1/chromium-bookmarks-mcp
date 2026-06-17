/** Detect installed Chromium browsers and their NativeMessagingHosts paths. */
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { existsSync } from 'node:fs';

export interface BrowserInfo {
  name: string;
  nativeHostDir: string;
  /** HKCU\Software\<this>\NativeMessagingHosts on Windows. Undefined on non-Windows. */
  windowsRegistryParent?: string;
}

/**
 * Injectable environment so OS detection and the existence filter can be unit
 * tested without touching the real platform/home dir/filesystem.
 */
export interface BrowserEnv {
  platform: () => NodeJS.Platform;
  homedir: () => string;
  existsSync: (p: string) => boolean;
  localAppData?: string;
}

const defaultEnv: BrowserEnv = {
  platform,
  homedir,
  existsSync,
  localAppData: process.env.LOCALAPPDATA,
};

/**
 * Files/dirs that only exist once a Chromium profile has actually been created.
 * The browser writes `Local State` and a `Default` profile dir on first run, so
 * presence of either is a far stronger "installed" signal than the mere
 * existence of the profile-root parent dir (which Chrome can create just by
 * being launched, or another tool can pre-create).
 */
const PROFILE_MARKERS = ['Local State', 'Default'];

function macBrowsers(env: BrowserEnv): BrowserInfo[] {
  const base = join(env.homedir(), 'Library', 'Application Support');
  return [
    { name: 'Chrome', nativeHostDir: join(base, 'Google', 'Chrome', 'NativeMessagingHosts') },
    { name: 'Brave', nativeHostDir: join(base, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') },
    { name: 'Edge', nativeHostDir: join(base, 'Microsoft Edge', 'NativeMessagingHosts') },
    { name: 'Arc', nativeHostDir: join(base, 'Arc', 'User Data', 'NativeMessagingHosts') },
    { name: 'Chromium', nativeHostDir: join(base, 'Chromium', 'NativeMessagingHosts') },
  ];
}

function linuxBrowsers(env: BrowserEnv): BrowserInfo[] {
  const home = env.homedir();
  return [
    { name: 'Chrome', nativeHostDir: join(home, '.config', 'google-chrome', 'NativeMessagingHosts') },
    { name: 'Brave', nativeHostDir: join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') },
    { name: 'Edge', nativeHostDir: join(home, '.config', 'microsoft-edge', 'NativeMessagingHosts') },
    { name: 'Chromium', nativeHostDir: join(home, '.config', 'chromium', 'NativeMessagingHosts') },
  ];
}

function windowsBrowsers(env: BrowserEnv): BrowserInfo[] {
  // On Windows, native messaging host manifests are registered via the file system under LOCALAPPDATA
  // AND via per-user registry keys under HKCU\Software\<vendor>\<browser>\NativeMessagingHosts.
  const localAppData = env.localAppData ?? join(env.homedir(), 'AppData', 'Local');
  return [
    {
      name: 'Chrome',
      nativeHostDir: join(localAppData, 'Google', 'Chrome', 'User Data', 'NativeMessagingHosts'),
      windowsRegistryParent: 'Google\\Chrome',
    },
    {
      name: 'Brave',
      nativeHostDir: join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'NativeMessagingHosts'),
      windowsRegistryParent: 'BraveSoftware\\Brave-Browser',
    },
    {
      name: 'Edge',
      nativeHostDir: join(localAppData, 'Microsoft', 'Edge', 'User Data', 'NativeMessagingHosts'),
      windowsRegistryParent: 'Microsoft\\Edge',
    },
  ];
}

/**
 * A browser counts as installed when its profile-root dir (the parent of
 * `NativeMessagingHosts`) carries a real profile marker — `Local State` or a
 * `Default` profile dir — not merely because the parent dir exists. This stops
 * us registering a native host into a browser that was never actually run,
 * while still passing every browser that a user has genuinely opened.
 */
function isInstalled(b: BrowserInfo, env: BrowserEnv): boolean {
  const profileRoot = join(b.nativeHostDir, '..');
  if (!env.existsSync(profileRoot)) return false;
  return PROFILE_MARKERS.some((marker) => env.existsSync(join(profileRoot, marker)));
}

export function getBrowserCandidates(env: BrowserEnv = defaultEnv): BrowserInfo[] {
  const os = env.platform();
  if (os === 'darwin') return macBrowsers(env);
  if (os === 'linux') return linuxBrowsers(env);
  if (os === 'win32') return windowsBrowsers(env);
  console.error(`Unsupported platform: ${os}. Native host registration not supported.`);
  return [];
}

export function getInstalledBrowsers(env: BrowserEnv = defaultEnv): BrowserInfo[] {
  return getBrowserCandidates(env).filter((b) => isInstalled(b, env));
}
