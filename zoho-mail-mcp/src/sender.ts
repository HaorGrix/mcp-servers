import nodemailer from "nodemailer";
import type { Config } from "./config.js";
import { redact } from "./config.js";

/**
 * Sends real mail from the Zoho mailbox, so it is deliberately hard to fire by
 * accident. Every send checks the enforced sender and honors dry-run. This is
 * the tool that answers a parent's reply, so the guardrails match brevo's.
 */
export class ZohoSender {
  constructor(private readonly config: Config) {}

  assertAllowed(from: string): void {
    const enforced = this.config.enforceSender;
    if (enforced && from.toLowerCase() !== enforced) {
      throw new Error(
        `Refusing to send from "${from}". ZOHO_ENFORCE_SENDER is "${enforced}".`,
      );
    }
  }

  async send(opts: {
    from: string;
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ messageId: string }> {
    this.assertAllowed(opts.from);

    if (this.config.dryRun) {
      throw new Error(
        `DRY RUN: refused to send to ${opts.to}. Unset ZOHO_DRY_RUN to allow sends.`,
      );
    }

    const transport = nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpPort === 465,
      auth: { user: this.config.user, pass: this.config.password },
    });

    try {
      const info = await transport.sendMail({
        from: opts.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
        ...(opts.references ? { references: opts.references } : {}),
      });
      return { messageId: info.messageId };
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(redact(`Zoho SMTP send failed: ${detail}`, this.config.password));
    } finally {
      transport.close();
    }
  }
}
