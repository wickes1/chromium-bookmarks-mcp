/** Register/unregister native messaging host manifest for detected browsers. */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { NATIVE_HOST_NAME, DEFAULT_PORT } from './types.js';
import { getInstalledBrowsers } from './browsers.js';
import { regAdd, regDelete, regQuery } from './windows-registry.js';

function getNativeHostPath(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const script = process.platform === 'win32' ? 'run_host.cmd' : 'run_host.sh';
  return join(thisDir, '..', 'bin', script);
}

interface ManifestJson {
  name: string;
  description: string;
  path: string;
  type: 'stdio';
  allowed_origins: string[];
}

export const PUBLISHED_EXTENSION_ID = 'ipcgfbbojaphhaoanjalmjmooeobjein';

function buildManifest(extensionId?: string): ManifestJson {
  const id = extensionId ?? PUBLISHED_EXTENSION_ID;
  return {
    name: NATIVE_HOST_NAME,
    description: 'MCP Server for Chromium Bookmarks',
    path: getNativeHostPath(),
    type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`],
  };
}

// Test-only export. Internal `buildManifest` stays unexported.
export const buildManifestForTest = buildManifest;

export function register(extensionId?: string): void {
  if (extensionId !== undefined && !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(
      `Invalid extension ID: "${extensionId}". Chrome extension IDs are exactly 32 lowercase letters a-p.`
    );
  }

  const browsers = getInstalledBrowsers();
  if (browsers.length === 0) {
    console.error('No supported Chromium browsers detected.');
    return;
  }

  const manifest = buildManifest(extensionId);
  const manifestJson = JSON.stringify(manifest, null, 2);
  const filename = `${NATIVE_HOST_NAME}.json`;

  for (const browser of browsers) {
    mkdirSync(browser.nativeHostDir, { recursive: true });
    const manifestPath = join(browser.nativeHostDir, filename);
    writeFileSync(manifestPath, manifestJson, 'utf-8');
    console.error(`Registered for ${browser.name}: ${manifestPath}`);
    if (process.platform === 'win32' && browser.windowsRegistryParent) {
      const regPath = `HKCU\\Software\\${browser.windowsRegistryParent}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
      regAdd(regPath, manifestPath);
      console.error(`  Registered registry key: ${regPath}`);
    }
  }
}

/**
 * Idempotent self-registration for stdio-proxy startup. Writes the native-host
 * manifest only if at least one detected browser is missing it or has a stale
 * `path` field (e.g. after npx cache eviction). Safe to call on every startup.
 */
export function ensureRegistered(): void {
  const browsers = getInstalledBrowsers();
  if (browsers.length === 0) return;

  const filename = `${NATIVE_HOST_NAME}.json`;
  const expectedPath = getNativeHostPath();

  const allCurrent = browsers.every((b) => {
    const manifestPath = join(b.nativeHostDir, filename);
    if (!existsSync(manifestPath)) return false;
    try {
      const raw = readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as { path?: string };
      if (parsed.path !== expectedPath) return false;
    } catch {
      return false;
    }
    if (process.platform === 'win32' && b.windowsRegistryParent) {
      const regPath = `HKCU\\Software\\${b.windowsRegistryParent}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
      if (regQuery(regPath) !== manifestPath) return false;
    }
    return true;
  });

  if (allCurrent) return;
  register();
}

export function unregister(): void {
  const browsers = getInstalledBrowsers();
  const filename = `${NATIVE_HOST_NAME}.json`;

  for (const browser of browsers) {
    const manifestPath = join(browser.nativeHostDir, filename);
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath);
      console.error(`Unregistered from ${browser.name}: ${manifestPath}`);
    }
    if (process.platform === 'win32' && browser.windowsRegistryParent) {
      const regPath = `HKCU\\Software\\${browser.windowsRegistryParent}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
      regDelete(regPath);
      console.error(`  Removed registry key: ${regPath}`);
    }
  }
}

export async function doctor(): Promise<void> {
  console.log('=== chromium-bookmarks-mcp doctor ===\n');

  const hostPath = getNativeHostPath();
  const hostExists = existsSync(hostPath);
  console.log(`Native host script: ${hostPath}`);
  console.log(`  Exists: ${hostExists ? 'YES' : 'NO'}`);

  const browsers = getInstalledBrowsers();
  const filename = `${NATIVE_HOST_NAME}.json`;
  console.log(`\nDetected browsers: ${browsers.length}`);
  for (const browser of browsers) {
    const manifestPath = join(browser.nativeHostDir, filename);
    const fileOk = existsSync(manifestPath);
    let status: string;
    if (process.platform === 'win32' && browser.windowsRegistryParent) {
      const regPath = `HKCU\\Software\\${browser.windowsRegistryParent}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
      const regValue = regQuery(regPath);
      const regOk = regValue === manifestPath;
      if (fileOk && regOk) status = 'REGISTERED';
      else if (fileOk && !regOk) status = 'MANIFEST OK / REGISTRY MISSING (run register)';
      else if (!fileOk && regOk) status = 'REGISTRY OK / MANIFEST MISSING (run register)';
      else status = 'NOT REGISTERED';
    } else {
      status = fileOk ? 'REGISTERED' : 'NOT REGISTERED';
    }
    console.log(`  ${browser.name}: ${status}`);
  }

  console.log('\nHTTP server connectivity:');
  try {
    const res = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/health`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    console.log(`  Status: CONNECTED — ${JSON.stringify(data)}`);
  } catch {
    console.log('  Status: NOT RUNNING (open browser and click the extension icon to activate)');
  }
}

// Test-only export.
export const getNativeHostPathForTest = getNativeHostPath;
