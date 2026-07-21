import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { loadConfig, redact } from '../config.js';
import { RateLimiter, backoffDelay, isRetryable } from '../ratelimit.js';
import { isMutating } from '../audit.js';

const VALID_KEY = 'xkeysib-0000000000000000000000000000000000000000000000000000000000000000';

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { BREVO_API_KEY: VALID_KEY, ...overrides };
}

describe('config', () => {
  test('accepts a valid key and applies defaults', () => {
    const cfg = loadConfig(env());
    assert.equal(cfg.baseUrl, 'https://api.brevo.com/v3');
    assert.equal(cfg.dryRun, false);
    assert.equal(cfg.maxRetries, 3);
    assert.equal(cfg.requestsPerSecond, 8);
    assert.equal(cfg.enforceSender, undefined);
  });

  test('rejects a missing key', () => {
    assert.throws(() => loadConfig({}), /BREVO_API_KEY is required/);
  });

  test('rejects a key with the wrong prefix', () => {
    assert.throws(() => loadConfig({ BREVO_API_KEY: 'sk-live-nope' }), /xkeysib-/);
  });

  test('normalises the enforced sender to lowercase', () => {
    const cfg = loadConfig(env({ BREVO_ENFORCE_SENDER: 'Abir@PodiumTutoring.com' }));
    assert.equal(cfg.enforceSender, 'abir@podiumtutoring.com');
  });

  test('rejects an enforced sender that is not an email', () => {
    assert.throws(() => loadConfig(env({ BREVO_ENFORCE_SENDER: 'abir' })), /must be an email/);
  });

  test('strips a trailing slash from the base url', () => {
    const cfg = loadConfig(env({ BREVO_BASE_URL: 'https://api.brevo.com/v3/' }));
    assert.equal(cfg.baseUrl, 'https://api.brevo.com/v3');
  });

  test('parses boolean env in every accepted spelling', () => {
    for (const truthy of ['1', 'true', 'yes', 'on', 'TRUE']) {
      assert.equal(loadConfig(env({ BREVO_DRY_RUN: truthy })).dryRun, true, truthy);
    }
    for (const falsy of ['0', 'false', 'no', 'off']) {
      assert.equal(loadConfig(env({ BREVO_DRY_RUN: falsy })).dryRun, false, falsy);
    }
  });

  test('rejects a non-boolean dry run value', () => {
    assert.throws(() => loadConfig(env({ BREVO_DRY_RUN: 'maybe' })), /must be a boolean/);
  });

  test('rejects out-of-range numeric env', () => {
    assert.throws(() => loadConfig(env({ BREVO_RPS: '0' })), /between 1 and 100/);
    assert.throws(() => loadConfig(env({ BREVO_MAX_RETRIES: '99' })), /between 0 and 10/);
    assert.throws(() => loadConfig(env({ BREVO_TIMEOUT_MS: 'fast' })), /must be an integer/);
  });
});

describe('redaction', () => {
  test('removes an api key from arbitrary text', () => {
    const out = redact(`request failed with api-key ${VALID_KEY} attached`);
    assert.ok(!out.includes(VALID_KEY));
    assert.match(out, /REDACTED/);
  });

  test('leaves text without a key untouched', () => {
    assert.equal(redact('plain error'), 'plain error');
  });
});

describe('rate limiter', () => {
  test('allows a full burst up to capacity without waiting', () => {
    const limiter = new RateLimiter(5, 0);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(limiter.reserve(0), 0, `token ${i} should be free`);
    }
  });

  test('makes the caller wait once the bucket is empty', () => {
    const limiter = new RateLimiter(5, 0);
    for (let i = 0; i < 5; i += 1) limiter.reserve(0);
    const wait = limiter.reserve(0);
    assert.ok(wait > 0, 'sixth call must wait');
    assert.ok(wait <= 200, `wait ${wait}ms should be about one token at 5rps`);
  });

  test('refills over time', () => {
    const limiter = new RateLimiter(10, 0);
    for (let i = 0; i < 10; i += 1) limiter.reserve(0);
    assert.equal(limiter.reserve(1000), 0, 'a full second later the bucket is full again');
  });

  test('never exceeds capacity when idle for a long time', () => {
    const limiter = new RateLimiter(3, 0);
    let free = 0;
    for (let i = 0; i < 10; i += 1) {
      if (limiter.reserve(60_000) === 0) free += 1;
    }
    assert.equal(free, 3, 'idle time must not build unlimited credit');
  });
});

describe('backoff', () => {
  test('stays within the exponential ceiling', () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const ceiling = Math.min(20_000, 500 * 2 ** attempt);
      for (let i = 0; i < 50; i += 1) {
        const delay = backoffDelay(attempt);
        assert.ok(delay >= 0 && delay < ceiling + 1, `attempt ${attempt} gave ${delay}`);
      }
    }
  });

  test('is capped so a retry storm cannot stall for minutes', () => {
    for (let i = 0; i < 100; i += 1) {
      assert.ok(backoffDelay(20) <= 20_000);
    }
  });
});

describe('retry policy', () => {
  test('retries throttling, timeouts and server errors', () => {
    for (const status of [429, 408, 500, 502, 503, 504]) {
      assert.equal(isRetryable(status), true, String(status));
    }
  });

  test('does not retry client errors', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      assert.equal(isRetryable(status), false, String(status));
    }
  });
});

describe('audit', () => {
  test('records writes and ignores reads', () => {
    assert.equal(isMutating('GET'), false);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      assert.equal(isMutating(method), true, method);
    }
  });
});
