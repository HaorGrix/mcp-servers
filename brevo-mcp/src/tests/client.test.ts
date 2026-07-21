import assert from 'node:assert/strict';
import { test, describe, beforeEach, afterEach } from 'node:test';
import { rm, readFile } from 'node:fs/promises';
import { BrevoClient, BrevoApiError, DryRunError } from '../client.js';
import type { Config } from '../config.js';

const AUDIT = 'test-audit.jsonl';

function config(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: 'xkeysib-test',
    baseUrl: 'https://api.brevo.test/v3',
    dryRun: false,
    timeoutMs: 5_000,
    maxRetries: 3,
    requestsPerSecond: 100,
    auditLogPath: AUDIT,
    ...overrides,
  };
}

/** Replaces global fetch with a scripted queue of responses. */
function stubFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  let i = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const spec = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    // 204 and 304 must carry a null body or the Response constructor throws.
    const nullBodyStatus = spec.status === 204 || spec.status === 304;
    const payload = nullBodyStatus || spec.body === undefined ? null : JSON.stringify(spec.body);
    return new Response(payload, {
      status: spec.status,
      headers: spec.headers ?? {},
    });
  }) as typeof fetch;
  return { calls, callCount: () => i };
}

const realFetch = globalThis.fetch;

describe('client', () => {
  beforeEach(async () => {
    await rm(AUDIT, { force: true });
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await rm(AUDIT, { force: true });
  });

  test('returns a parsed body on success', async () => {
    stubFetch([{ status: 200, body: { email: 'abir@podiumtutoring.com' } }]);
    const client = new BrevoClient(config());
    const account = await client.get<{ email: string }>('/account');
    assert.equal(account.email, 'abir@podiumtutoring.com');
  });

  test('sends the api key header', async () => {
    const stub = stubFetch([{ status: 200, body: {} }]);
    await new BrevoClient(config()).get('/account');
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0]!.url, /api\.brevo\.test\/v3\/account/);
  });

  test('handles an empty 204 body', async () => {
    stubFetch([{ status: 204 }]);
    const result = await new BrevoClient(config()).put('/contacts/x', { a: 1 });
    assert.equal(result, undefined);
  });

  test('retries a 429 then succeeds', async () => {
    const stub = stubFetch([
      { status: 429, body: { code: 'too_many_requests', message: 'slow down' }, headers: { 'retry-after': '0' } },
      { status: 200, body: { ok: true } },
    ]);
    const result = await new BrevoClient(config()).get<{ ok: boolean }>('/account');
    assert.equal(result.ok, true);
    assert.equal(stub.callCount(), 2, 'should have retried exactly once');
  });

  test('retries 5xx up to maxRetries then throws', async () => {
    const stub = stubFetch([{ status: 500, body: { code: 'server', message: 'boom' } }]);
    const client = new BrevoClient(config({ maxRetries: 2 }));
    await assert.rejects(() => client.get('/account'), (err: unknown) => {
      assert.ok(err instanceof BrevoApiError);
      assert.equal(err.status, 500);
      return true;
    });
    assert.equal(stub.callCount(), 3, 'initial attempt plus two retries');
  });

  test('does not retry a 401', async () => {
    const stub = stubFetch([{ status: 401, body: { code: 'unauthorized', message: 'bad key' } }]);
    await assert.rejects(() => new BrevoClient(config()).get('/account'));
    assert.equal(stub.callCount(), 1, 'auth failures must fail fast');
  });

  test('surfaces the Brevo error code and message', async () => {
    stubFetch([{ status: 400, body: { code: 'invalid_parameter', message: 'listIds is required' } }]);
    await assert.rejects(() => new BrevoClient(config()).post('/emailCampaigns', {}), /listIds is required/);
  });

  test('never leaks the api key in an error message', async () => {
    stubFetch([{ status: 400, body: { code: 'bad', message: 'key xkeysib-abc123def456 rejected' } }]);
    await assert.rejects(
      () => new BrevoClient(config()).get('/account'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(!err.message.includes('xkeysib-abc123def456'), err.message);
        assert.match(err.message, /REDACTED/);
        return true;
      },
    );
  });

  test('dry run refuses writes but allows reads', async () => {
    stubFetch([{ status: 200, body: { ok: true } }]);
    const client = new BrevoClient(config({ dryRun: true }));
    await client.get('/account');
    await assert.rejects(() => client.post('/emailCampaigns', {}), DryRunError);
  });

  test('writes an audit line for a mutation', async () => {
    stubFetch([{ status: 201, body: { id: 7 } }]);
    await new BrevoClient(config()).post('/emailCampaigns', { name: 'x' });
    const log = await readFile(AUDIT, 'utf8');
    const entry = JSON.parse(log.trim());
    assert.equal(entry.method, 'POST');
    assert.equal(entry.path, '/emailCampaigns');
    assert.equal(entry.status, 201);
  });

  test('does not audit reads', async () => {
    stubFetch([{ status: 200, body: {} }]);
    await new BrevoClient(config()).get('/account');
    await assert.rejects(() => readFile(AUDIT, 'utf8'));
  });

  test('audits a dry-run refusal so blocked intent is still recorded', async () => {
    const client = new BrevoClient(config({ dryRun: true }));
    await assert.rejects(() => client.post('/emailCampaigns/1/sendNow', {}));
    const entry = JSON.parse((await readFile(AUDIT, 'utf8')).trim());
    assert.equal(entry.status, 'dry-run');
  });

  test('getAll walks pages until a short page ends it', async () => {
    const page = (n: number) => ({ status: 200, body: { contacts: Array.from({ length: n }, (_, i) => ({ id: i })) } });
    stubFetch([page(2), page(2), page(1)]);
    const client = new BrevoClient(config());
    const all = await client.getAll<{ id: number }>('/contacts', 'contacts', 2);
    assert.equal(all.length, 5);
  });

  test('getAll stops on an empty page', async () => {
    stubFetch([{ status: 200, body: { contacts: [] } }]);
    const all = await new BrevoClient(config()).getAll('/contacts', 'contacts', 50);
    assert.deepEqual(all, []);
  });
});
