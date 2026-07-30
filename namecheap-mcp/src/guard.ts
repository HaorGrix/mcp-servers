/**
 * Destructive-operation gate.
 *
 * Namecheap's `setHosts` command is a full replace: it does not patch, it
 * overwrites every DNS record on the domain with exactly what you send. A single
 * careless call silently deletes mail routing, verification records, and the
 * site itself. Every write in this server therefore reads the current record set
 * first and rewrites it in full, and anything that removes or replaces records
 * must be confirmed by echoing the domain name back.
 */

export class ConfirmationRequiredError extends Error {
  constructor(action: string, expected: string, why: string) {
    super(
      `${action} was NOT performed. To proceed, call again with confirm set to exactly: "${expected}". ` +
        `${why}`,
    );
    this.name = "ConfirmationRequiredError";
  }
}

export class UnsafeOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeOperationError";
  }
}

/**
 * Require the caller to echo back the domain name. Comparing against the real
 * domain rather than a fixed string like "yes" means the confirmation cannot be
 * satisfied without having actually identified the target.
 */
export function requireConfirmation(
  action: string,
  domain: string,
  confirm: string | undefined,
  why: string,
): void {
  if (confirm === undefined || confirm.trim().toLowerCase() !== domain.trim().toLowerCase()) {
    throw new ConfirmationRequiredError(action, domain, why);
  }
}

/**
 * Refuses a write that would drop existing records unnoticed. `setHosts` replaces
 * everything, so a rewrite that comes back with fewer records than it started
 * with is treated as a mistake unless it was explicitly confirmed.
 */
export function assertNoSilentLoss(before: number, after: number, confirmed: boolean): void {
  if (after < before && !confirmed) {
    throw new UnsafeOperationError(
      `This change would reduce the record count from ${before} to ${after}. ` +
        `Namecheap replaces the entire zone on every write, so records not included are deleted. ` +
        `If that is intended, pass the confirm parameter.`,
    );
  }
}

/** Operations that can remove DNS records or change delegation. Kept in one place so it is auditable. */
export const DESTRUCTIVE = Object.freeze([
  "namecheap_delete_dns_record",
  "namecheap_replace_all_dns_records",
  "namecheap_set_nameservers",
  "namecheap_use_namecheap_dns",
  "namecheap_set_email_forwarding",
]);
