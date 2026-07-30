import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat, mkdir } from 'node:fs/promises';
import { loadConfig, redact, blockedIn, isProtectedDomain } from '../config.js';
import { requireConfirm, RefusedError } from '../guards.js';
import { writeSecretFile, fingerprintOf } from '../secrets.js';
import { AuditLog, AuditWriteError } from '../audit.js';
import { annotateKeys } from '../tools/read.js';

const BASE_ENV = { RESEND_API_KEY: 're_testkey0000000000' } as NodeJS.ProcessEnv;

function toolsFor(env: NodeJS.ProcessEnv): string[] {
  const config = loadConfig(env);
  const names = ['resend_list_api_keys', 'resend_list_domains'];
  if (config.allowWrites) names.push('resend_create_api_key', 'resend_send_email');
  if (config.allowDestructive) names.push('resend_delete_api_key', 'resend_delete_domain');
  return names;
}

// --- 1. absence -------------------------------------------------------------

test('write and destructive tools are absent from the tool list when flags are off', () => {
  const names = toolsFor({ ...BASE_ENV });
  assert.ok(names.includes('resend_list_api_keys'));
  assert.ok(!names.includes('resend_send_email'), 'sending must not be reachable by default');
  assert.ok(!names.includes('resend_delete_api_key'));
});

test('destructive tools stay absent when only writes are enabled', () => {
  const names = toolsFor({ ...BASE_ENV, RESEND_ALLOW_WRITES: 'true' });
  assert.ok(names.includes('resend_send_email'));
  assert.ok(!names.includes('resend_delete_api_key'));
});

test('destructive without writes is refused at boot', () => {
  assert.throws(
    () => loadConfig({ ...BASE_ENV, RESEND_ALLOW_DESTRUCTIVE: 'true' }),
    /requires RESEND_ALLOW_WRITES/,
  );
});

// --- 2. confirm must match --------------------------------------------------

test('confirm must equal the FULL key id — no abbreviations', () => {
  const keyId = 'b6a3f2c1-9d4e-4a7b-8c2f-1e5d9a0b3c7d';
  assert.throws(() => requireConfirm(keyId, 'confirm'), RefusedError);
  assert.throws(() => requireConfirm(keyId, 'edugrix-2026'), RefusedError, 'a NAME must not confirm an id');
  assert.doesNotThrow(() => requireConfirm(keyId, keyId));
  // The last-6 shortcut is gone. Resend already cannot show key values, so the
  // id is the only proof of identity - accepting a fragment of it undercuts that.
  assert.throws(() => requireConfirm(keyId, '0b3c7d'), RefusedError, 'a 6-char tail must be refused');
});

// --- 3. no secret in any envelope or log line -------------------------------

const FAKE_TOKEN = 're_AbCdEf123456789012345678';

test('a created key goes to a 0600 file and never into the response', async () => {
  const path = 'secrets-test/resend.key';
  await rm('secrets-test', { recursive: true, force: true });

  const handle = await writeSecretFile(path, FAKE_TOKEN, 'test key');
  assert.ok(!JSON.stringify(handle).includes(FAKE_TOKEN));
  assert.equal(await readFile(handle.path, 'utf8'), FAKE_TOKEN);
  if (process.platform !== 'win32') {
    assert.equal((await stat(handle.path)).mode & 0o777, 0o600);
  }
  assert.equal(fingerprintOf(FAKE_TOKEN), handle.fingerprint);

  await rm('secrets-test', { recursive: true, force: true });
});

test('the audit journal never persists a Resend token', async () => {
  const path = 'audit.test.jsonl';
  await rm(path, { force: true });
  const audit = new AuditLog(path);
  await audit.record({
    ts: new Date().toISOString(),
    tool: 'resend_create_api_key',
    args: { name: 'edugrix-2026', token: FAKE_TOKEN },
    resourceId: 'key-1',
    outcome: 'ok',
    detail: `token was ${FAKE_TOKEN}`,
  });
  const written = await readFile(path, 'utf8');
  assert.ok(!written.includes(FAKE_TOKEN), 'token must be redacted');
  assert.ok(written.includes('[REDACTED]'));
  await rm(path, { force: true });
});

test('redact masks re_ tokens', () => {
  assert.ok(!redact(`key=${FAKE_TOKEN}`).includes(FAKE_TOKEN));
});

// --- the blocked-recipient rule ---------------------------------------------

test('zennpsi@gmail.com is blocked by default and cannot be configured away', () => {
  const bare = loadConfig({ ...BASE_ENV });
  assert.ok(bare.blockedRecipients.includes('zennpsi@gmail.com'), 'blocked with an empty .env');

  // An override that omits the permanent rule still keeps it.
  const overridden = loadConfig({ ...BASE_ENV, RESEND_BLOCKED_RECIPIENTS: 'someone@else.com' });
  assert.ok(
    overridden.blockedRecipients.includes('zennpsi@gmail.com'),
    'the permanent rule must survive an override that leaves it out',
  );
  assert.ok(overridden.blockedRecipients.includes('someone@else.com'));
});

test('blockedIn catches a blocked address anywhere in the recipient list', () => {
  const config = loadConfig({ ...BASE_ENV });
  assert.deepEqual(blockedIn(config, ['a@b.com']), []);
  assert.deepEqual(blockedIn(config, ['a@b.com', 'zennpsi@gmail.com']), ['zennpsi@gmail.com']);
  assert.deepEqual(blockedIn(config, ['ZENNPSI@Gmail.com']), ['zennpsi@gmail.com'], 'case-insensitive');
  assert.deepEqual(blockedIn(config, ['  zennpsi@gmail.com  ']), ['zennpsi@gmail.com'], 'trimmed');
});

test('the blocked address cannot be set as the enforced sender either', () => {
  assert.throws(
    () => loadConfig({ ...BASE_ENV, RESEND_ENFORCE_SENDER: 'zennpsi@gmail.com' }),
    /never a sender/,
  );
});

test('protected domains are refused regardless of flags', () => {
  const config = loadConfig({
    ...BASE_ENV,
    RESEND_ALLOW_WRITES: 'true',
    RESEND_ALLOW_DESTRUCTIVE: 'true',
    RESEND_PROTECTED_DOMAINS: 'haorgrix.com,edugrix.haorgrix.com',
  });
  assert.ok(isProtectedDomain(config, 'haorgrix.com'));
  assert.ok(isProtectedDomain(config, 'HAORGRIX.COM'), 'case-insensitive');
  assert.ok(!isProtectedDomain(config, 'example.com'));
});

// --- key identification by date ---------------------------------------------

test('keys created before the breach date are flagged suspect', () => {
  const rows = annotateKeys(
    [
      { id: 'k1', name: 'old-key', created_at: '2026-05-01T00:00:00Z' },
      { id: 'k2', name: 'new-key', created_at: '2026-07-01T00:00:00Z' },
    ],
    '2026-06-24',
  );
  assert.equal(rows[0]?.suspect, true, 'pre-breach key is suspect');
  assert.ok(rows[0]?.reason?.includes('2026-06-24'));
  assert.equal(rows[1]?.suspect, false, 'post-breach key is clean');
  assert.equal(rows[1]?.reason, undefined);
});

test('a destructive call fails closed when the audit journal cannot be written', async () => {
  // A directory can never be appended to — a real write failure, not a mock.
  const unwritable = 'audit-unwritable-dir';
  await rm(unwritable, { recursive: true, force: true });
  await mkdir(unwritable, { recursive: true });
  const audit = new AuditLog(unwritable);
  const entry = {
    ts: new Date().toISOString(),
    tool: 'resend_delete_api_key',
    args: { keyId: 'k-1' },
    resourceId: 'k-1',
    outcome: 'pending' as const,
  };
  await assert.rejects(() => audit.recordCritical(entry), AuditWriteError);
  await assert.doesNotReject(() => audit.record(entry));
  await rm(unwritable, { recursive: true, force: true });
});
