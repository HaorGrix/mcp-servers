import { writeFile, mkdir, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Credential handoff that never puts the value in the response.
 *
 * A tool result is not ephemeral — it lands in the conversation transcript and
 * stays there. Treating the transcript as a log is not paranoia: a Hetzner
 * read-write token was pasted into a chat window on 2026-07-29 and had to be
 * rotated for exactly this reason.
 *
 * So anything that returns a live credential writes it to a 0600 file and
 * returns the path plus a short fingerprint. The fingerprint is enough to match
 * the file against a provider console; it is not enough to authenticate.
 */
export interface SecretHandle {
  /** Absolute path to the 0600 file holding the credential. */
  path: string;
  /** First 12 hex chars of the SHA-256 of the value. Identifies, does not authenticate. */
  fingerprint: string;
  /** Bytes written, so a caller can sanity-check a truncated write. */
  bytes: number;
  /** How the file is actually protected on this platform. */
  protection: string;
  note: string;
}

export async function writeSecretFile(
  path: string,
  value: string,
  label: string,
): Promise<SecretHandle> {
  if (!value) {
    // An empty credential file is worse than none: it looks like success and
    // deploys as a broken secret. A provider returning nothing is a bug to
    // surface, not a value to persist.
    throw new Error('Refusing to write an empty credential file — the provider returned no value.');
  }
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  // Written 0600 from the start rather than created then tightened — a
  // world-readable window, however brief, is how /var/www/haorgrix ended up
  // mode 777 with secrets in it.
  await writeFile(absolute, value, { encoding: 'utf8', mode: 0o600 });
  // Explicit chmod because `mode` is ignored when the file already exists.
  await chmod(absolute, 0o600);
  const protection = await restrictToOwner(absolute);

  return {
    path: absolute,
    fingerprint: fingerprintOf(value),
    bytes: Buffer.byteLength(value, 'utf8'),
    protection,
    note:
      `${label} written to ${absolute}, ${protection}. The value is deliberately NOT in this ` +
      `response: a tool result lands in the conversation transcript and stays there. Read it ` +
      `from the file, move it where it belongs, then delete the file.`,
  };
}

/**
 * Make the file readable only by its owner, on this platform.
 *
 * POSIX mode bits are advisory on Windows: NTFS ACLs govern, and a freshly
 * written file inherits `Authenticated Users:(M)` and `BUILTIN\Users:(RX)` from
 * the parent directory. chmod(0o600) does not remove those, so a private key
 * written here was readable by every local account — verified on 2026-07-30
 * against a real key this function had just written, and the reason this exists.
 *
 * The file is DELETED if it cannot be protected. A credential that cannot be
 * secured must not be left lying around as a consolation prize.
 */
async function restrictToOwner(absolute: string): Promise<string> {
  if (process.platform !== 'win32') return 'mode 0600';

  const user = process.env['USERNAME'];
  if (!user) {
    await rm(absolute, { force: true });
    throw new Error(
      'Cannot determine the current Windows user, so the credential file cannot be ' +
        'ACL-restricted. The file has been deleted rather than left readable by every local account.',
    );
  }
  try {
    // /inheritance:r drops the inherited Users and Authenticated Users entries;
    // /grant:r replaces rather than adds, so this is the complete ACL.
    // D is included deliberately: without delete, the owner cannot remove the
    // file this function's own note tells them to delete once it is consumed.
    await run('icacls', [absolute, '/inheritance:r', '/grant:r', `${user}:(R,W,D)`], {
      windowsHide: true,
    });
    return `NTFS ACL restricted to ${user} (POSIX mode is advisory on Windows)`;
  } catch (err: unknown) {
    await rm(absolute, { force: true });
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to ACL-restrict the credential file (${detail}). The file has been deleted rather ` +
        'than left readable by every local account.',
    );
  }
}

/** Stable short identifier for a secret, safe to log, print and paste. */
export function fingerprintOf(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}
