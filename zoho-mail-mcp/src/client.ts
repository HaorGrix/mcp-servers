import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Config } from "./config.js";
import { redact } from "./config.js";

export interface MailSummary {
  uid: number;
  from: string;
  fromName: string;
  subject: string;
  date: string;
  seen: boolean;
  preview: string;
}

export interface MailFull extends MailSummary {
  to: string;
  text: string;
  inReplyTo?: string;
}

/**
 * Thin IMAP wrapper. Opens a fresh connection per call rather than holding one
 * open: an MCP server is idle most of the time, and a dropped long-lived IMAP
 * socket is a worse failure mode than a 300ms reconnect.
 */
export class ZohoClient {
  constructor(private readonly config: Config) {}

  private connect(): ImapFlow {
    return new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false,
    });
  }

  private async withMailbox<T>(
    mailbox: string,
    fn: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = this.connect();
    try {
      await client.connect();
      // readOnly lock: the mailbox is opened without write intent, so nothing
      // this server does can flag, move or delete a message.
      const lock = await client.getMailboxLock(mailbox, { readOnly: this.config.readOnly });
      try {
        return await fn(client);
      } finally {
        lock.release();
      }
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(redact(`Zoho IMAP error: ${detail}`, this.config.password));
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  async listMailboxes(): Promise<string[]> {
    const client = this.connect();
    try {
      await client.connect();
      const boxes = await client.list();
      return boxes.map((b) => b.path);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  /** Most recent messages in a mailbox, newest first. */
  async recent(mailbox: string, limit: number): Promise<MailSummary[]> {
    return this.withMailbox(mailbox, async (client) => {
      const total = client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.exists : 0;
      if (!total) return [];
      const start = Math.max(1, total - limit + 1);
      const out: MailSummary[] = [];
      for await (const msg of client.fetch(`${start}:*`, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
        source: true,
      })) {
        out.push(await toSummary(msg));
      }
      return out.sort((a, b) => b.uid - a.uid);
    });
  }

  /** IMAP search. `criteria` is an imapflow search object. */
  async search(mailbox: string, criteria: Record<string, unknown>, limit: number): Promise<MailSummary[]> {
    return this.withMailbox(mailbox, async (client) => {
      const uids = await client.search(criteria, { uid: true });
      if (!uids || uids.length === 0) return [];
      const pick = uids.slice(-limit);
      const out: MailSummary[] = [];
      for await (const msg of client.fetch(pick, { uid: true, envelope: true, flags: true, source: true }, { uid: true })) {
        out.push(await toSummary(msg));
      }
      return out.sort((a, b) => b.uid - a.uid);
    });
  }

  /** Flag a message as read. Needs the mailbox opened writable (ZOHO_READ_ONLY=0). */
  async markSeen(mailbox: string, uid: number, seen: boolean): Promise<boolean> {
    if (this.config.readOnly) {
      throw new Error("Mailbox is read-only. Set ZOHO_READ_ONLY=0 to change message flags.");
    }
    return this.withMailbox(mailbox, async (client) => {
      return seen
        ? client.messageFlagsAdd({ uid: `${uid}` }, ["\\Seen"], { uid: true })
        : client.messageFlagsRemove({ uid: `${uid}` }, ["\\Seen"], { uid: true });
    });
  }

  /** Move a message to another folder. Needs writable access. */
  async move(mailbox: string, uid: number, target: string): Promise<unknown> {
    if (this.config.readOnly) {
      throw new Error("Mailbox is read-only. Set ZOHO_READ_ONLY=0 to move messages.");
    }
    return this.withMailbox(mailbox, async (client) => {
      return client.messageMove({ uid: `${uid}` }, target, { uid: true });
    });
  }

  async read(mailbox: string, uid: number): Promise<MailFull | null> {
    return this.withMailbox(mailbox, async (client) => {
      let result: MailFull | null = null;
      for await (const msg of client.fetch({ uid: `${uid}` }, { uid: true, envelope: true, flags: true, source: true }, { uid: true })) {
        const summary = await toSummary(msg);
        const parsed = msg.source ? await simpleParser(msg.source) : null;
        result = {
          ...summary,
          to: parsed?.to && "text" in parsed.to ? parsed.to.text : "",
          text: (parsed?.text ?? summary.preview).trim(),
          ...(parsed?.inReplyTo ? { inReplyTo: parsed.inReplyTo } : {}),
        };
      }
      return result;
    });
  }
}

async function toSummary(msg: {
  uid: number;
  envelope?: { from?: Array<{ name?: string; address?: string }>; subject?: string; date?: Date };
  flags?: Set<string>;
  source?: Buffer;
}): Promise<MailSummary> {
  const from = msg.envelope?.from?.[0];
  let preview = "";
  if (msg.source) {
    const parsed = await simpleParser(msg.source);
    preview = (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  }
  return {
    uid: msg.uid,
    from: from?.address ?? "",
    fromName: from?.name ?? "",
    subject: msg.envelope?.subject ?? "(no subject)",
    date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : "",
    seen: msg.flags?.has("\\Seen") ?? false,
    preview,
  };
}
