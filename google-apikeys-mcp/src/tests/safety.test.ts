import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat, mkdir } from 'node:fs/promises';
import { loadConfig, redact, isProtected } from '../config.js';
import { requireConfirm, RefusedError } from '../guards.js';
import { writeSecretFile, fingerprintOf } from '../secrets.js';
import { AuditLog, AuditWriteError } from '../audit.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { summarise, keyIdOf } from '../tools/read.js';

const BASE_ENV = { GCP_PROJECT_ID: 'haorgrix-mcp' } as NodeJS.ProcessEnv;

/** Mirrors index.ts registration without needing credentials or a socket. */
function toolsFor(env: NodeJS.ProcessEnv): string[] {
  const config = loadConfig(env);
  const names = ['apikeys_list', 'apikeys_get', 'apikeys_lookup'];
  if (config.allowWrites) names.push('apikeys_create', 'apikeys_update_restrictions');
  if (config.allowDestructive) names.push('apikeys_delete', 'apikeys_undelete');
  return names;
}

// --- 1. absence -------------------------------------------------------------

test('write and destructive tools are absent from the tool list when flags are off', () => {
  const names = toolsFor({ ...BASE_ENV });
  assert.ok(names.includes('apikeys_list'));
  assert.ok(!names.includes('apikeys_create'), 'write tool must not be registered');
  assert.ok(!names.includes('apikeys_delete'), 'destructive tool must not be registered');
});

test('destructive tools stay absent when only writes are enabled', () => {
  const names = toolsFor({ ...BASE_ENV, APIKEYS_ALLOW_WRITES: 'true' });
  assert.ok(names.includes('apikeys_create'));
  assert.ok(!names.includes('apikeys_delete'));
});

test('destructive without writes is refused at boot', () => {
  assert.throws(
    () => loadConfig({ ...BASE_ENV, APIKEYS_ALLOW_DESTRUCTIVE: 'true' }),
    /requires APIKEYS_ALLOW_WRITES/,
  );
});

// --- 2. confirm must match --------------------------------------------------

test('confirm must equal the FULL key id — no abbreviations', () => {
  const keyId = '6f8a1c2e-4b7d-4e39-9a12-3c5d7e9f0a1b';
  assert.throws(() => requireConfirm(keyId, 'confirm'), RefusedError);
  assert.throws(() => requireConfirm(keyId, 'DELETE'), RefusedError);
  assert.throws(() => requireConfirm(keyId, '6f8a1c2e-4b7d-4e39-9a12-3c5d7e9f0a1c'), RefusedError);
  assert.doesNotThrow(() => requireConfirm(keyId, keyId));
  // The last-6 shortcut is gone: a truncated id in list output would otherwise
  // let an agent destroy a key it never fetched.
  assert.throws(() => requireConfirm(keyId, '9f0a1b'), RefusedError, 'a 6-char tail must be refused');
});

test('protected key ids are refused regardless of flags', () => {
  const config = loadConfig({
    ...BASE_ENV,
    APIKEYS_ALLOW_WRITES: 'true',
    APIKEYS_ALLOW_DESTRUCTIVE: 'true',
    APIKEYS_PROTECTED_KEYS: 'abc-123,DEF-456',
  });
  assert.ok(isProtected(config, 'abc-123'));
  assert.ok(isProtected(config, 'def-456'), 'case-insensitive');
  assert.ok(!isProtected(config, 'ghi-789'));
});

// --- 3. no secret in any envelope or log line -------------------------------

const FAKE_KEY_STRING = 'AIzaSyBOdwFFxxxxxxxxxxxxxxxxxxxxxxxxxxx';

test('a created key string goes to a 0600 file and never into the response', async () => {
  const path = 'secrets-test/key.key';
  await rm('secrets-test', { recursive: true, force: true });

  const handle = await writeSecretFile(path, FAKE_KEY_STRING, 'test key');

  assert.ok(!JSON.stringify(handle).includes(FAKE_KEY_STRING), 'response must not carry the value');
  assert.equal(handle.fingerprint.length, 12);
  assert.equal(await readFile(handle.path, 'utf8'), FAKE_KEY_STRING);
  if (process.platform === 'win32') {
    // POSIX mode is advisory on Windows: chmod(0o600) leaves the inherited ACL
    // intact, so assert on the ACL that actually governs.
    const { stdout } = await execFileAsync('icacls', [handle.path], { windowsHide: true });
    assert.ok(!/Authenticated Users/i.test(stdout), `Authenticated Users must not retain access:
${stdout}`);
    assert.ok(!/BUILTIN\Users/i.test(stdout), `BUILTIN\Users must not retain access:
${stdout}`);
    assert.ok(handle.protection.includes('NTFS ACL'));
  } else {
    assert.equal((await stat(handle.path)).mode & 0o777, 0o600);
    assert.equal(handle.protection, 'mode 0600');
  }
  assert.equal(fingerprintOf(FAKE_KEY_STRING), handle.fingerprint);

  await rm('secrets-test', { recursive: true, force: true });
});

test('the audit journal never persists a key string', async () => {
  const path = 'audit.test.jsonl';
  await rm(path, { force: true });
  const audit = new AuditLog(path);

  await audit.record({
    ts: new Date().toISOString(),
    tool: 'apikeys_create',
    args: { displayName: 'test', keyString: FAKE_KEY_STRING },
    resourceId: 'key-1',
    outcome: 'ok',
    status: 200,
    detail: `leaked ${FAKE_KEY_STRING} here`,
  });

  const written = await readFile(path, 'utf8');
  assert.ok(!written.includes(FAKE_KEY_STRING), 'key string must be redacted');
  assert.ok(written.includes('[REDACTED]'));
  assert.ok(written.includes('key-1'), 'the resource id is still recorded');

  await rm(path, { force: true });
});

test('redact masks Google API keys wherever they appear', () => {
  assert.ok(!redact(`key=${FAKE_KEY_STRING}`).includes(FAKE_KEY_STRING));
});

// --- unrestricted-key surfacing --------------------------------------------

test('summarise flags an unrestricted key rather than reporting it silently', () => {
  const bare = summarise({ name: 'projects/p/locations/global/keys/abc-123' });
  assert.equal(bare.keyId, 'abc-123');
  assert.equal(bare.unrestricted, true);
  assert.ok(bare.warning?.includes('UNRESTRICTED'), 'an unrestricted key must be called out');

  const scoped = summarise({
    name: 'projects/p/locations/global/keys/def-456',
    restrictions: { apiTargets: [{ service: 'generativelanguage.googleapis.com' }] },
  });
  assert.equal(scoped.unrestricted, false);
  assert.equal(scoped.warning, undefined);
});

test('keyIdOf extracts the id from a full resource name', () => {
  assert.equal(keyIdOf('projects/haorgrix-mcp/locations/global/keys/xyz-789'), 'xyz-789');
  assert.equal(keyIdOf('xyz-789'), 'xyz-789');
});

test('a destructive call fails closed when the audit journal cannot be written', async () => {
  // A directory can never be appended to — a real write failure, not a mock.
  const unwritable = 'audit-unwritable-dir';
  await rm(unwritable, { recursive: true, force: true });
  await mkdir(unwritable, { recursive: true });
  const audit = new AuditLog(unwritable);
  const entry = {
    ts: new Date().toISOString(),
    tool: 'apikeys_delete',
    args: { keyId: 'abc-123' },
    resourceId: 'abc-123',
    outcome: 'pending' as const,
  };
  await assert.rejects(() => audit.recordCritical(entry), AuditWriteError);
  await assert.doesNotReject(() => audit.record(entry));
  await rm(unwritable, { recursive: true, force: true });
});
