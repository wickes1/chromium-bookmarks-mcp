/** Register/unregister native messaging host manifest for detected browsers. */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, renameSync, rmSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { NATIVE_HOST_NAME, DEFAULT_PORT } from './types.js';
import { getInstalledBrowsers } from './browsers.js';
import { regAdd, regDelete, regQuery } from './windows-registry.js';

function getNativeHostPath(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const script = process.platform === 'win32' ? 'run_host.cmd' : 'run_host.sh';
  return join(thisDir, '..', 'bin', script);
}

/**
 * Normalize a manifest path for comparison across the value we wrote and the
 * value reg.exe reads back (which can differ in trailing separators and, on
 * the case-insensitive Windows filesystem, in casing).
 */
function normalizePathForCompare(p: string): string {
  const trimmed = p.trim().replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * Write a manifest atomically: write to a sibling temp file with restrictive
 * perms, then rename over the destination. The rename is atomic on the same
 * filesystem, so a reader never observes a half-written manifest, and the
 * temp file is created fresh ({ flag: 'wx' }) so we never follow a pre-existing
 * symlink at the destination path (TOCTOU/symlink hardening).
 */
function writeManifestAtomic(manifestPath: string, contents: string): void {
  const tmpPath = `${manifestPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, contents, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    renameSync(tmpPath, manifestPath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

interface ManifestJson {
  name: string;
  description: string;
  path: string;
  type: 'stdio';
  allowed_origins: string[];
}

/**
 * Raw TCP connect to a localhost port to tell "nothing is listening" (free)
 * from "something is listening but not answering /health" (occupied). Used by
 * doctor when the /health probe fails, so a port conflict is distinguishable
 * from the host simply not running.
 */
function probePort(port: number, timeoutMs = 1500): Promise<'free' | 'occupied'> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    let settled = false;
    const done = (result: 'free' | 'occupied') => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done('occupied'));
    socket.once('timeout', () => done('free'));
    socket.once('error', () => done('free'));
  });
}

/** Read a written manifest's allowed_origins for doctor display. Null if unreadable. */
function readManifestOrigins(manifestPath: string): string[] | null {
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as { allowed_origins?: unknown };
    return Array.isArray(parsed.allowed_origins) ? (parsed.allowed_origins as string[]) : null;
  } catch {
    return null;
  }
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
    console.error(
      'Next step: open Chrome, Brave, Edge, or Arc at least once, then re-run `chromium-bookmarks-mcp register`.'
    );
    return;
  }

  const manifest = buildManifest(extensionId);
  const manifestJson = JSON.stringify(manifest, null, 2);
  const filename = `${NATIVE_HOST_NAME}.json`;

  for (const browser of browsers) {
    mkdirSync(browser.nativeHostDir, { recursive: true });
    const manifestPath = join(browser.nativeHostDir, filename);
    writeManifestAtomic(manifestPath, manifestJson);
    console.error(`Registered for ${browser.name}: ${manifestPath}`);
    if (process.platform === 'win32' && browser.windowsRegistryParent) {
      const regPath = `HKCU\\Software\\${browser.windowsRegistryParent}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
      regAdd(regPath, manifestPath);
      console.error(`  Registered registry key: ${regPath}`);
    }
  }
}

/**
 * Injectable dependencies for the idempotency check, so the staleness logic can
 * be unit tested against a temp dir without touching real browser detection or
 * the real native-host path. Defaults wire up the production implementations.
 */
export interface EnsureRegisteredDeps {
  browsers: { nativeHostDir: string; windowsRegistryParent?: string }[];
  expectedPath: string;
  fileExists: (p: string) => boolean;
  readFile: (p: string) => string;
  regRead: (keyPath: string) => string | null;
  doRegister: () => void;
}

/** Shared idempotency decision: returns true when every browser manifest is current. */
function allManifestsCurrent(deps: EnsureRegisteredDeps): boolean {
  const filename = `${NATIVE_HOST_NAME}.json`;
  return deps.browsers.every((b) => {
    const manifestPath = join(b.nativeHostDir, filename);
    if (!deps.fileExists(manifestPath)) return false;
    try {
      const parsed = JSON.parse(deps.readFile(manifestPath)) as { path?: string };
      if (parsed.path !== deps.expectedPath) return false;
    } catch {
      return false;
    }
    if (process.platform === 'win32' && b.windowsRegistryParent) {
      const regPath = `HKCU\\Software\\${b.windowsRegistryParent}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
      const regValue = deps.regRead(regPath);
      if (regValue === null) return false;
      if (normalizePathForCompare(regValue) !== normalizePathForCompare(manifestPath)) return false;
    }
    return true;
  });
}

/**
 * Core of ensureRegistered, expressed against injectable deps. Re-registers only
 * when at least one browser manifest is missing or stale. Exported for testing.
 */
export function ensureRegisteredWith(deps: EnsureRegisteredDeps): void {
  if (deps.browsers.length === 0) return;
  if (allManifestsCurrent(deps)) return;
  deps.doRegister();
}

/**
 * Idempotent self-registration for stdio-proxy startup. Writes the native-host
 * manifest only if at least one detected browser is missing it or has a stale
 * `path` field (e.g. after npx cache eviction). Safe to call on every startup.
 */
export function ensureRegistered(): void {
  ensureRegisteredWith({
    browsers: getInstalledBrowsers(),
    expectedPath: getNativeHostPath(),
    fileExists: existsSync,
    readFile: (p) => readFileSync(p, 'utf-8'),
    regRead: regQuery,
    doRegister: register,
  });
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
      const regOk = regValue !== null &&
        normalizePathForCompare(regValue) === normalizePathForCompare(manifestPath);
      if (fileOk && regOk) status = 'REGISTERED';
      else if (fileOk && !regOk) status = 'MANIFEST OK / REGISTRY MISSING (run register)';
      else if (!fileOk && regOk) status = 'REGISTRY OK / MANIFEST MISSING (run register)';
      else status = 'NOT REGISTERED';
    } else {
      status = fileOk ? 'REGISTERED' : 'NOT REGISTERED';
    }
    console.log(`  ${browser.name}: ${status}`);
    if (fileOk) {
      const origins = readManifestOrigins(manifestPath);
      console.log(`    allowed_origins: ${origins ? origins.join(', ') : '(unreadable)'}`);
    }
  }
  console.log(`\nExpected extension ID: ${PUBLISHED_EXTENSION_ID}`);
  console.log('  (allowed_origins above must contain chrome-extension://<this id>/ to connect)');

  console.log('\nHTTP server connectivity:');
  try {
    const res = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/health`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    console.log(`  Status: CONNECTED — ${JSON.stringify(data)}`);
  } catch {
    const portState = await probePort(DEFAULT_PORT);
    if (portState === 'occupied') {
      console.log(
        `  Status: PORT ${DEFAULT_PORT} OCCUPIED but /health failed — another process holds the port, or a second browser is already connected.`
      );
    } else {
      console.log(
        `  Status: NOT RUNNING (port ${DEFAULT_PORT} is free — open browser and click the extension icon to activate)`
      );
    }
  }
}

// Test-only export.
export const getNativeHostPathForTest = getNativeHostPath;
