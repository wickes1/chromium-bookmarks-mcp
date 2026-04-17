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

export function getInstalledBrowsers(): BrowserInfo[] {
  const os = platform();
  let browsers: BrowserInfo[];

  if (os === 'darwin') {
    browsers = macBrowsers();
  } else if (os === 'linux') {
    browsers = linuxBrowsers();
  } else {
    console.error('Windows native host registration not yet supported. Use manual registration.');
    return [];
  }

  return browsers.filter((b) => {
    const parentDir = join(b.nativeHostDir, '..');
    return existsSync(parentDir);
  });
}
