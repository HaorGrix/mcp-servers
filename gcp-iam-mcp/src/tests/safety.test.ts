import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, redact, isProtected } from '../config.js';
import { requireConfirm, requireNotProtected, RefusedError } from '../guards.js';
import { AuditLog } from '../audit.js';
import { writeSecretFile, fingerprintOf } from '../secrets.js';
import { readFile, rm, stat } from 'node:fs/promises';

const BASE_ENV = { GCP_PROJECT_ID: 'haorgrix-mcp' } as NodeJS.ProcessEnv;

/**
 * The three tests Tuhin marked non-negotiable, in his order.
 * Everything else in this file supports one of them.
 */

// ---------------------------------------------------------------------------
// 1. Write tools are ABSENT from tools/list when the flag is off.
// ---------------------------------------------------------------------------

/** Mirrors index.ts registration logic without needing credentials or a socket. */
function toolsFor(env: NodeJS.ProcessEnv): string[] {
  const config = loadConfig(env);
  const names: string[] = ['gcp_list_service_accounts', 'gcp_get_service_account', 'gcp_list_sa_keys'];
  if (config.allowWrites) names.push('gcp_create_sa_key', 'gcp_create_service_account');
  if (config.allowDestructive) names.push('gcp_delete_sa_key', 'gcp_delete_service_account');
  return names;
}

test('write and destructive tools are absent from the tool list when flags are off', () => {
  const names = toolsFor({ ...BASE_ENV });
  assert.ok(names.includes('gcp_list_sa_keys'), 'read tools must always be present');
  assert.ok(!names.includes('gcp_create_sa_key'), 'write tool must not be registered');
  assert.ok(!names.includes('gcp_delete_sa_key'), 'destructive tool must not be registered');
});

test('destructive tools stay absent when only writes are enabled', () => {
  const names = toolsFor({ ...BASE_ENV, GCP_ALLOW_WRITES: 'true' });
  assert.ok(names.includes('gcp_create_sa_key'), 'write tool should appear');
  assert.ok(!names.includes('gcp_delete_sa_key'), 'destructive needs its own flag');
});

test('enabling destructive without writes is refused at boot, not at call time', () => {
  assert.throws(
    () => loadConfig({ ...BASE_ENV, GCP_ALLOW_DESTRUCTIVE: 'true' }),
    /requires GCP_ALLOW_WRITES/,
  );
});

// ---------------------------------------------------------------------------
// 2. A destructive call is refused when the confirm id does not match.
// ---------------------------------------------------------------------------

test('confirm must equal the exact resource id, or its last 6 characters', () => {
  const keyId = '5a393106448c92a76ae4c0f5fd6af88ae4a401d6';

  assert.throws(() => requireConfirm(keyId, 'confirm'), RefusedError, 'a literal must not pass');
  assert.throws(() => requireConfirm(keyId, 'DELETE'), RefusedError);
  assert.throws(() => requireConfirm(keyId, ''), RefusedError);
  assert.throws(
    () => requireConfirm(keyId, '631156c63fa808681f10f3466368aee91335db27'),
    RefusedError,
    'a DIFFERENT real key id must not pass — this is the two-keys-on-one-account case',
  );

  assert.doesNotThrow(() => requireConfirm(keyId, keyId));
  assert.doesNotThrow(() => requireConfirm(keyId, 'a401d6'), 'last 6 chars are accepted');
});

test('protected service accounts are refused regardless of flags', () => {
  const config = loadConfig({ ...BASE_ENV, GCP_ALLOW_WRITES: 'true', GCP_ALLOW_DESTRUCTIVE: 'true' });
  const protectedId = 'search-console-mcp@haorgrix-mcp.iam.gserviceaccount.com';

  assert.ok(isProtected(config, protectedId), 'ships protected by default');
  assert.ok(isProtected(config, protectedId.toUpperCase()), 'case-insensitive');
  assert.throws(() => requireNotProtected(config, protectedId), RefusedError);
  assert.doesNotThrow(() => requireNotProtected(config, 'something-else@haorgrix-mcp.iam.gserviceaccount.com'));
});

// ---------------------------------------------------------------------------
// 3. No secret value appears in any response envelope or log line.
//    The one Tuhin most wants to see fail if someone regresses it.
// ---------------------------------------------------------------------------

const FAKE_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ\n-----END PRIVATE KEY-----';
const FAKE_API_KEY = 'AIzaSyBOdwFFxxxxxxxxxxxxxxxxxxxxxxxxxxx';

test('redact removes private keys, API keys and bearer tokens', () => {
  assert.ok(!redact(FAKE_PRIVATE_KEY).includes('MIIEvQIBADANBgkq'));
  assert.ok(!redact(`key=${FAKE_API_KEY}`).includes(FAKE_API_KEY));
  assert.ok(!redact('Authorization: Bearer ya29.abcdefghijklmnopqrstuvwxyz').includes('ya29.abcdef'));
  assert.equal(redact('nothing sensitive here'), 'nothing sensitive here');
});

test('a created credential goes to a 0600 file and never into the response', async () => {
  const path = 'secrets-test/key.json';
  await rm('secrets-test', { recursive: true, force: true });

  const handle = await writeSecretFile(path, FAKE_PRIVATE_KEY, 'test key');

  // The handle is what a tool returns. It must not carry the value.
  const serialised = JSON.stringify(handle);
  assert.ok(!serialised.includes('MIIEvQIBADANBgkq'), 'the response must not contain key material');
  assert.equal(handle.fingerprint.length, 12, 'fingerprint identifies, it does not authenticate');
  assert.ok(!FAKE_PRIVATE_KEY.includes(handle.fingerprint), 'fingerprint is a hash, not a substring');

  // The file must exist, hold the real value, and be owner-only.
  const onDisk = await readFile(handle.path, 'utf8');
  assert.equal(onDisk, FAKE_PRIVATE_KEY, 'the file holds the actual credential');
  if (process.platform !== 'win32') {
    const mode = (await stat(handle.path)).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
  }

  // Same input, same fingerprint — so a file can be matched to a console entry.
  assert.equal(fingerprintOf(FAKE_PRIVATE_KEY), handle.fingerprint);

  await rm('secrets-test', { recursive: true, force: true });
});

test('the audit journal never persists key material', async () => {
  const path = 'audit.test.jsonl';
  await rm(path, { force: true });
  const audit = new AuditLog(path);

  await audit.record({
    ts: new Date().toISOString(),
    tool: 'gcp_create_sa_key',
    args: { email: 'x@y.iam.gserviceaccount.com', privateKeyData: FAKE_PRIVATE_KEY },
    resourceId: 'abc123',
    outcome: 'ok',
    status: 200,
    detail: `leaked ${FAKE_API_KEY} in the detail field`,
  });

  const written = await readFile(path, 'utf8');
  assert.ok(!written.includes('MIIEvQIBADANBgkq'), 'private key material must never be persisted');
  assert.ok(!written.includes(FAKE_API_KEY), 'an API key in detail must be redacted');
  assert.ok(written.includes('[REDACTED]'), 'redaction marker should be present');
  assert.ok(written.includes('gcp_create_sa_key'), 'the tool name is still recorded');
  assert.ok(written.includes('abc123'), 'the resource id is still recorded');

  await rm(path, { force: true });
});
