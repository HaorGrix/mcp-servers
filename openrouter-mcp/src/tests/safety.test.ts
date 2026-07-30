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
import { summariseKey } from '../tools/index.js';

const BASE_ENV = { OPENROUTER_PROVISIONING_KEY: 'sk-or-prov-test000000' } as NodeJS.ProcessEnv;

function toolsFor(env: NodeJS.ProcessEnv): string[] {
  const config = loadConfig(env);
  const names = ['openrouter_list_keys', 'openrouter_get_credits', 'openrouter_list_models'];
  if (config.allowWrites) names.push('openrouter_create_key', 'openrouter_update_key');
  if (config.allowDestructive) names.push('openrouter_delete_key');
  return names;
}

// --- 1. absence -------------------------------------------------------------

test('write and destructive tools are absent from the tool list when flags are off', () => {
  const names = toolsFor({ ...BASE_ENV });
  assert.ok(names.includes('openrouter_list_keys'));
  assert.ok(!names.includes('openrouter_create_key'));
  assert.ok(!names.includes('openrouter_delete_key'));
});

test('destructive tools stay absent when only writes are enabled', () => {
  const names = toolsFor({ ...BASE_ENV, OPENROUTER_ALLOW_WRITES: 'true' });
  assert.ok(names.includes('openrouter_create_key'));
  assert.ok(!names.includes('openrouter_delete_key'));
});

test('destructive without writes is refused at boot', () => {
  assert.throws(
    () => loadConfig({ ...BASE_ENV, OPENROUTER_ALLOW_DESTRUCTIVE: 'true' }),
    /requires OPENROUTER_ALLOW_WRITES/,
  );
});

test('a missing provisioning key fails at boot with a message that names the right key type', () => {
  assert.throws(() => loadConfig({}), /PROVISIONING key/);
});

// --- 2. confirm must match --------------------------------------------------

test('confirm must equal the FULL key hash — no abbreviations', () => {
  const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';
  assert.throws(() => requireConfirm(hash, 'confirm'), RefusedError);
  assert.throws(() => requireConfirm(hash, 'reiva-2026'), RefusedError, 'a name must not confirm a hash');
  assert.doesNotThrow(() => requireConfirm(hash, hash));
  // The last-6 shortcut is gone: hex hashes make a 6-char collision entirely
  // plausible across a real key set.
  assert.throws(() => requireConfirm(hash, 'ae41e4'), RefusedError, 'a 6-char tail must be refused');
});

test('protected key hashes are refused regardless of flags', () => {
  const config = loadConfig({
    ...BASE_ENV,
    OPENROUTER_ALLOW_WRITES: 'true',
    OPENROUTER_ALLOW_DESTRUCTIVE: 'true',
    OPENROUTER_PROTECTED_KEYS: 'abc123,DEF456',
  });
  assert.ok(isProtected(config, 'abc123'));
  assert.ok(isProtected(config, 'def456'), 'case-insensitive');
  assert.ok(!isProtected(config, 'ghi789'));
});

// --- 3. no secret in any envelope or log line -------------------------------

const FAKE_KEY = 'sk-or-v1-e5d5c8d0123456789abcdef0123456789abcdef0123456789abcdef01234567';

test('a created key goes to a 0600 file and never into the response', async () => {
  const path = 'secrets-test/or.key';
  await rm('secrets-test', { recursive: true, force: true });

  const handle = await writeSecretFile(path, FAKE_KEY, 'test key');
  assert.ok(!JSON.stringify(handle).includes(FAKE_KEY));
  assert.equal(await readFile(handle.path, 'utf8'), FAKE_KEY);
  if (process.platform === 'win32') {
    // POSIX mode is advisory on Windows: chmod(0o600) leaves the inherited ACL
    // intact, so assert on the ACL that actually governs.
    const { stdout } = await execFileAsync('icacls', [handle.path], { windowsHide: true });
    assert.ok(!/Authenticated Users/i.test(stdout), 'Authenticated Users must not retain access');
    assert.ok(!/BUILTIN.Users/i.test(stdout), 'BUILTIN\Users must not retain access');
    assert.ok(handle.protection.includes('NTFS ACL'));
  } else {
    assert.equal((await stat(handle.path)).mode & 0o777, 0o600);
    assert.equal(handle.protection, 'mode 0600');
  }
  assert.equal(fingerprintOf(FAKE_KEY), handle.fingerprint);

  await rm('secrets-test', { recursive: true, force: true });
});

test('the audit journal never persists an OpenRouter key', async () => {
  const path = 'audit.test.jsonl';
  await rm(path, { force: true });
  const audit = new AuditLog(path);
  await audit.record({
    ts: new Date().toISOString(),
    tool: 'openrouter_create_key',
    args: { name: 'reiva-2026', apiKey: FAKE_KEY },
    resourceId: 'hash-1',
    outcome: 'ok',
    detail: `key was ${FAKE_KEY}`,
  });
  const written = await readFile(path, 'utf8');
  assert.ok(!written.includes(FAKE_KEY), 'key must be redacted');
  assert.ok(written.includes('[REDACTED]'));
  assert.ok(written.includes('hash-1'), 'the resource id is still recorded');
  await rm(path, { force: true });
});

test('redact masks sk-or-v1 keys', () => {
  assert.ok(!redact(`key=${FAKE_KEY}`).includes(FAKE_KEY));
});

// --- spend safety -----------------------------------------------------------

test('summariseKey flags an uncapped key rather than reporting it silently', () => {
  const uncapped = summariseKey({ hash: 'h1', name: 'no-limit', limit: null, usage: 12 });
  assert.equal(uncapped.uncapped, true);
  assert.equal(uncapped.remaining, null);
  assert.ok(uncapped.warning?.includes('entire account balance'));

  const capped = summariseKey({ hash: 'h2', name: 'capped', limit: 100, usage: 40 });
  assert.equal(capped.uncapped, false);
  assert.equal(capped.remaining, 60, 'remaining is limit minus usage');
  assert.equal(capped.warning, undefined);
});

test('remaining never goes negative when usage overshoots the limit', () => {
  const over = summariseKey({ hash: 'h3', name: 'over', limit: 10, usage: 25 });
  assert.equal(over.remaining, 0);
});

test('a destructive call fails closed when the audit journal cannot be written', async () => {
  // A directory can never be appended to — a real write failure, not a mock.
  const unwritable = 'audit-unwritable-dir';
  await rm(unwritable, { recursive: true, force: true });
  await mkdir(unwritable, { recursive: true });
  const audit = new AuditLog(unwritable);
  const entry = {
    ts: new Date().toISOString(),
    tool: 'openrouter_delete_key',
    args: { keyHash: 'h-1' },
    resourceId: 'h-1',
    outcome: 'pending' as const,
  };
  await assert.rejects(() => audit.recordCritical(entry), AuditWriteError);
  await assert.doesNotReject(() => audit.record(entry));
  await rm(unwritable, { recursive: true, force: true });
});
