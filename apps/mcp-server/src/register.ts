import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { NATIVE_HOST_NAME, DEFAULT_PORT } from '@chromium-bookmarks-mcp/shared';
import { getInstalledBrowsers } from './browsers.js';

function getNativeHostPath(): string {
  const thisDir = dirname(new URL(import.meta.url).pathname);
  return join(thisDir, '..', 'bin', 'run_host.sh');
}

interface ManifestJson {
  name: string;
  description: string;
  path: string;
  type: 'stdio';
  allowed_origins: string[];
}

function buildManifest(extensionId?: string): ManifestJson {
  const origins = extensionId
    ? [`chrome-extension://${extensionId}/`]
    : ['chrome-extension://*/'];

  return {
    name: NATIVE_HOST_NAME,
    description: 'MCP Server for Chromium Bookmarks',
    path: getNativeHostPath(),
    type: 'stdio',
    allowed_origins: origins,
  };
}

export function register(extensionId?: string): void {
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
    console.log(`Registered for ${browser.name}: ${manifestPath}`);
  }
}

export function unregister(): void {
  const browsers = getInstalledBrowsers();
  const filename = `${NATIVE_HOST_NAME}.json`;

  for (const browser of browsers) {
    const manifestPath = join(browser.nativeHostDir, filename);
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath);
      console.log(`Unregistered from ${browser.name}: ${manifestPath}`);
    }
  }
}

export function doctor(): void {
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
    const registered = existsSync(manifestPath);
    console.log(`  ${browser.name}: ${registered ? 'REGISTERED' : 'NOT REGISTERED'}`);
  }

  console.log('\nHTTP server connectivity:');
  fetch(`http://127.0.0.1:${DEFAULT_PORT}/health`, { signal: AbortSignal.timeout(2000) })
    .then((res) => res.json())
    .then((data) => console.log(`  Status: CONNECTED — ${JSON.stringify(data)}`))
    .catch(() => console.log('  Status: NOT RUNNING (extension may not be open)'));
}
