import type { Config } from './config.js';
import { isProtected } from './config.js';

/** MCP tool return shape used across every tool in this server. */
export function ok(payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

/**
 * Layer 2 of the safety model: the caller must echo back the FULL id being destroyed.
 *
 * A fixed literal like confirm:"DELETE" is passed reflexively by an agent that
 * has not looked at anything. Requiring the id means you cannot confirm without
 * having read the specific resource first.
 *
 * An earlier version also accepted the last 6 characters. That shortcut is gone:
 * list output routinely truncates ids, so a 6-character tail is available to an
 * agent that never fetched the resource — the exact case this guard exists to
 * stop — and 6 characters is short enough to collide across a real key set.
 */
export function requireConfirm(resourceId: string, confirm: string): void {
  const id = resourceId.trim();
  if (confirm.trim() !== id) {
    throw new RefusedError(
      `confirm did not match. Pass the exact, complete resource id ("${id}"). Abbreviations are ` +
        `not accepted. Refusing so a destructive call cannot be made without reading the resource first.`,
    );
  }
}

/**
 * The denylist. Checked before flags, before confirm, before anything —
 * flags protect against the wrong mode, this protects against the right mode
 * and the wrong id.
 */
export function requireNotProtected(config: Config, resourceId: string): void {
  if (isProtected(config, resourceId)) {
    throw new RefusedError(
      `"${resourceId}" is on GCP_PROTECTED_SERVICE_ACCOUNTS and cannot be destroyed through this ` +
        `server under any flag combination. Remove it from the denylist deliberately, in config, ` +
        `if that is genuinely intended.`,
    );
  }
}

/**
 * A dry run must prove the resource exists and report the exact mutation.
 * Echoing arguments back is theatre — it builds confidence without evidence —
 * so every caller passes a `probe` that hits the provider's read path.
 */
export async function dryRun<T>(
  probe: () => Promise<T>,
  describe: (found: T) => string,
): Promise<ReturnType<typeof ok>> {
  const found = await probe();
  return ok({ dryRun: true, resourceExists: true, wouldDo: describe(found) });
}
