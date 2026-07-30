import { writeFile, mkdir, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

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
  note: string;
}

export async function writeSecretFile(
  path: string,
  value: string,
  label: string,
): Promise<SecretHandle> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  // Written 0600 from the start rather than created then tightened — a
  // world-readable window, however brief, is how /var/www/haorgrix ended up
  // mode 777 with secrets in it.
  await writeFile(absolute, value, { encoding: 'utf8', mode: 0o600 });
  // Explicit chmod because `mode` is ignored when the file already exists.
  await chmod(absolute, 0o600);

  return {
    path: absolute,
    fingerprint: fingerprintOf(value),
    bytes: Buffer.byteLength(value, 'utf8'),
    note:
      `${label} written to ${absolute} with mode 0600. The value is deliberately NOT in this ` +
      `response: a tool result lands in the conversation transcript and stays there. Read it ` +
      `from the file, move it where it belongs, then delete the file.`,
  };
}

/** Stable short identifier for a secret, safe to log, print and paste. */
export function fingerprintOf(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}
