/** Write and destructive-operation gating shared by every module. */
import { z } from "zod";
import type { Config } from "./config.js";
import { GraphError } from "./client.js";

export const confirmSchema = z
  .boolean()
  .optional()
  .describe("Must be true to execute. This operation is destructive or spends money and will not run without explicit confirmation.");

export function assertWrites(config: Config, action: string): void {
  if (!config.allowWrites) {
    throw new GraphError(`${action} is a write operation and META_ALLOW_WRITES=false. Set it to true to enable writes.`, { code: -1, type: "WritesDisabled" });
  }
}

export function assertConfirmed(config: Config, confirm: boolean | undefined, action: string): void {
  assertWrites(config, action);
  if (confirm !== true) {
    throw new GraphError(`${action} requires confirm=true. Re-run with confirm: true once you have checked the target.`, { code: -1, type: "ConfirmRequired" });
  }
}

/** Resolve an optional id argument against the configured default, or fail clearly. */
export function resolveId(value: string | undefined, fallback: string | undefined, label: string, envKey: string): string {
  const v = value?.trim() || fallback;
  if (!v) throw new GraphError(`${label} is required: pass it as an argument or set ${envKey} in .env.`, { code: -1, type: "MissingArgument" });
  return v;
}
