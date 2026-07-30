import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat, mkdir } from 'node:fs/promises';
import { loadConfig, redact, isProtected } from '../config.js';
import { requireConfirm, RefusedError } from '../guards.js';
import { writeSecretFile, fingerprintOf } from '../secrets.js';
import { AuditLog, AuditWriteError } from '../audit.js';

const BASE_ENV = { NEON_API_KEY: 'napi_testkey000000000000000' } as NodeJS.ProcessEnv;

function toolsFor(env: NodeJS.ProcessEnv): string[] {
  const config = loadConfig(env);
  const names = ['neon_list_projects', 'neon_list_roles', 'neon_get_connection_uri'];
  if (config.allowWrites) names.push('neon_create_project', 'neon_create_branch');
  if (config.allowDestructive) names.push('neon_reset_role_password', 'neon_delete_project');
  return names;
}

// --- 1. absence -------------------------------------------------------------

test('write and destructive tools are absent from the tool list when flags are off', () => {
  const names = toolsFor({ ...BASE_ENV });
  assert.ok(names.includes('neon_list_projects'));
  assert.ok(!names.includes('neon_create_project'));
  assert.ok(!names.includes('neon_delete_project'));
  assert.ok(!names.includes('neon_reset_role_password'), 'the atomic reset is destructive-tier');
});

test('destructive tools stay absent when only writes are enabled', () => {
  const names = toolsFor({ ...BASE_ENV, NEON_ALLOW_WRITES: 'true' });
  assert.ok(names.includes('neon_create_project'));
  assert.ok(!names.includes('neon_delete_project'));
});

test('destructive without writes is refused at boot', () => {
  assert.throws(
    () => loadConfig({ ...BASE_ENV, NEON_ALLOW_DESTRUCTIVE: 'true' }),
    /requires NEON_ALLOW_WRITES/,
  );
});

// --- 2. confirm must match --------------------------------------------------

test('confirm must equal the FULL resource id — no abbreviations', () => {
  const projectId = 'ep-shy-bread-am1akxy2';
  assert.throws(() => requireConfirm(projectId, 'confirm'), RefusedError);
  assert.throws(() => requireConfirm(projectId, 'DELETE'), RefusedError);
  assert.throws(() => requireConfirm(projectId, 'ep-shy-bread-am1akxy3'), RefusedError);
  assert.doesNotThrow(() => requireConfirm(projectId, projectId));
  // The last-6 shortcut is gone: a truncated id in list output would otherwise
  // let an agent destroy a project it never fetched.
  assert.throws(() => requireConfirm(projectId, '1akxy2'), RefusedError, 'a 6-char tail must be refused');
});

test('protected projects are refused regardless of flags', () => {
  const config = loadConfig({
    ...BASE_ENV,
    NEON_ALLOW_WRITES: 'true',
    NEON_ALLOW_DESTRUCTIVE: 'true',
    NEON_PROTECTED_PROJECTS: 'ep-shy-bread-am1akxy2,other-proj',
  });
  assert.ok(isProtected(config, 'ep-shy-bread-am1akxy2'), 'reiva project is protected');
  assert.ok(isProtected(config, 'EP-SHY-BREAD-AM1AKXY2'), 'case-insensitive');
  assert.ok(!isProtected(config, 'unrelated-project'));
});

// --- 3. no secret in any envelope or log line -------------------------------

const FAKE_URI = 'postgresql://neondb_owner:sup3rs3cr3tpw@ep-shy-bread-am1akxy2.us-east-1.aws.neon.tech/neondb';

test('redact masks the password inside a connection URI', () => {
  const masked = redact(FAKE_URI);
  assert.ok(!masked.includes('sup3rs3cr3tpw'), 'the password must never survive redaction');
  assert.ok(masked.includes('[REDACTED]'));
});

test('a connection URI goes to a 0600 file and never into the response', async () => {
  const path = 'secrets-test/conn.uri';
  await rm('secrets-test', { recursive: true, force: true });

  const handle = await writeSecretFile(path, FAKE_URI, 'test uri');

  assert.ok(!JSON.stringify(handle).includes('sup3rs3cr3tpw'), 'response must not carry the password');
  assert.equal(handle.fingerprint.length, 12);
  assert.equal(await readFile(handle.path, 'utf8'), FAKE_URI);
  if (process.platform !== 'win32') {
    assert.equal((await stat(handle.path)).mode & 0o777, 0o600);
  }
  assert.equal(fingerprintOf(FAKE_URI), handle.fingerprint);

  await rm('secrets-test', { recursive: true, force: true });
});

test('the audit journal never persists a connection URI or password', async () => {
  const path = 'audit.test.jsonl';
  await rm(path, { force: true });
  const audit = new AuditLog(path);

  await audit.record({
    ts: new Date().toISOString(),
    tool: 'neon_reset_role_password',
    args: { roleName: 'neondb_owner', password: 'sup3rs3cr3tpw' },
    resourceId: 'neondb_owner',
    outcome: 'ok',
    status: 200,
    detail: `uri was ${FAKE_URI}`,
  });

  const written = await readFile(path, 'utf8');
  assert.ok(!written.includes('sup3rs3cr3tpw'), 'password must be redacted everywhere');
  assert.ok(written.includes('[REDACTED]'));
  assert.ok(written.includes('neondb_owner'), 'the role name is still recorded');

  await rm(path, { force: true });
});

test('a destructive call fails closed when the audit journal cannot be written', async () => {
  // A directory can never be appended to — a real write failure, not a mock.
  const unwritable = 'audit-unwritable-dir';
  await rm(unwritable, { recursive: true, force: true });
  await mkdir(unwritable, { recursive: true });
  const audit = new AuditLog(unwritable);
  const entry = {
    ts: new Date().toISOString(),
    tool: 'neon_reset_role_password',
    args: { roleName: 'neondb_owner' },
    resourceId: 'neondb_owner',
    outcome: 'pending' as const,
  };
  await assert.rejects(() => audit.recordCritical(entry), AuditWriteError);
  await assert.doesNotReject(() => audit.record(entry));
  await rm(unwritable, { recursive: true, force: true });
});
