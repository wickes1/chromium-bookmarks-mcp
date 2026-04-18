/** Detect installed Chromium browsers and their NativeMessagingHosts paths. */
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { existsSync } from 'node:fs';

export interface BrowserInfo {
  name: string;
  nativeHostDir: string;
}

function macBrowsers(): BrowserInfo[] {
  const home = homedir();
  const base = join(home, 'Library', 'Application Support');
  return [
    { name: 'Chrome', nativeHostDir: join(base, 'Google', 'Chrome', 'NativeMessagingHosts') },
    { name: 'Brave', nativeHostDir: join(base, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') },
    { name: 'Edge', nativeHostDir: join(base, 'Microsoft Edge', 'NativeMessagingHosts') },
    { name: 'Arc', nativeHostDir: join(base, 'Arc', 'User Data', 'NativeMessagingHosts') },
    { name: 'Chromium', nativeHostDir: join(base, 'Chromium', 'NativeMessagingHosts') },
  ];
}

function linuxBrowsers(): BrowserInfo[] {
  const home = homedir();
  return [
    { name: 'Chrome', nativeHostDir: join(home, '.config', 'google-chrome', 'NativeMessagingHosts') },
    { name: 'Brave', nativeHostDir: join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') },
    { name: 'Edge', nativeHostDir: join(home, '.config', 'microsoft-edge', 'NativeMessagingHosts') },
    { name: 'Chromium', nativeHostDir: join(home, '.config', 'chromium', 'NativeMessagingHosts') },
  ];
}

function windowsBrowsers(): BrowserInfo[] {
  // On Windows, native messaging host manifests are registered via the file system under LOCALAPPDATA.
  const localAppData =
    process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return [
    {
      name: 'Chrome',
      nativeHostDir: join(localAppData, 'Google', 'Chrome', 'User Data', 'NativeMessagingHosts'),
    },
    {
      name: 'Brave',
      nativeHostDir: join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'NativeMessagingHosts'),
    },
    {
      name: 'Edge',
      nativeHostDir: join(localAppData, 'Microsoft', 'Edge', 'User Data', 'NativeMessagingHosts'),
    },
  ];
}

export function getInstalledBrowsers(): BrowserInfo[] {
  const os = platform();
  let browsers: BrowserInfo[];

  if (os === 'darwin') {
    browsers = macBrowsers();
  } else if (os === 'linux') {
    browsers = linuxBrowsers();
  } else if (os === 'win32') {
    browsers = windowsBrowsers();
  } else {
    console.error(`Unsupported platform: ${os}. Native host registration not supported.`);
    return [];
  }

  return browsers.filter((b) => {
    const parentDir = join(b.nativeHostDir, '..');
    return existsSync(parentDir);
  });
}
