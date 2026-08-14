/**
 * Destructive-operation gate.
 *
 * Hetzner API tokens have no granular scopes: a read-write token can delete every
 * server in the project. This module is the compensating control. Anything that
 * destroys data or capacity must be named exactly by the caller, so a wrong
 * inference or a fat-fingered id cannot take production down.
 */

export class ConfirmationRequiredError extends Error {
  constructor(action: string, expected: string) {
    super(
      `${action} is a destructive operation and was NOT performed. ` +
        `To proceed, call again with confirm set to exactly: "${expected}". ` +
        `This gate exists because a Hetzner read-write token can delete the entire project.`,
    );
    this.name = "ConfirmationRequiredError";
  }
}

export class ProtectedResourceError extends Error {
  constructor(kind: string, name: string) {
    super(
      `${kind} "${name}" has Hetzner delete-protection enabled and will not be touched. ` +
        `Remove protection in the Hetzner console first — deliberately not exposed as a tool here.`,
    );
    this.name = "ProtectedResourceError";
  }
}

/**
 * Require the caller to echo back the resource's own name. Comparing against the
 * real name (not a fixed string like "yes") means the confirmation cannot be
 * satisfied without having actually looked the resource up.
 */
export function requireConfirmation(action: string, resourceName: string, confirm: string | undefined): void {
  if (confirm === undefined || confirm.trim() !== resourceName) {
    throw new ConfirmationRequiredError(action, resourceName);
  }
}

/** Operations that can destroy data or capacity. Kept in one place so it is auditable. */
export const DESTRUCTIVE = Object.freeze([
  "hcloud_delete_server",
  "hcloud_rebuild_server",
  "hcloud_delete_snapshot",
  "hcloud_delete_firewall",
  "hcloud_delete_ssh_key",
  "hcloud_power_off_server",
]);
