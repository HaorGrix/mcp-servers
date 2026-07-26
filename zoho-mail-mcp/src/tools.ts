import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZohoClient, type MailSummary } from "./client.js";

function ok(payload: unknown) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

/** A grade in a short reply is the signal we care about most. */
const GRADE = /\b(grade\s*)?(1[0-2]|[1-9])(st|nd|rd|th)?\s*(grade|grader)?\b/i;
const SUBJECTS = /\b(math|algebra|geometry|calculus|english|ela|science|biology|chemistry|physics|history|regents|reading|writing)\b/i;

export function registerTools(server: McpServer, client: ZohoClient): void {
  server.tool(
    "zoho_list_folders",
    "List the folders in the mailbox (Inbox, Sent, Spam, and any custom ones).",
    {},
    async () => ok(await client.listMailboxes()),
  );

  server.tool(
    "zoho_recent",
    "Most recent messages in a folder, newest first. Use this to see what has come in.",
    {
      folder: z.string().optional().default("INBOX").describe('Folder name, defaults to "INBOX"'),
      limit: z.number().int().min(1).max(100).optional().default(25),
    },
    async ({ folder, limit }) => ok(await client.recent(folder, limit)),
  );

  server.tool(
    "zoho_read",
    "Read one full message by its UID, including the body text.",
    {
      uid: z.number().int().describe("Message UID from a list or search result"),
      folder: z.string().optional().default("INBOX"),
    },
    async ({ uid, folder }) => {
      const mail = await client.read(folder, uid);
      return mail ? ok(mail) : ok(`No message with UID ${uid} in ${folder}.`);
    },
  );

  server.tool(
    "zoho_search",
    "Search a folder. Combine any of: from, subject, text (body), since (YYYY-MM-DD), unseen.",
    {
      folder: z.string().optional().default("INBOX"),
      from: z.string().optional().describe("Sender address contains"),
      subject: z.string().optional().describe("Subject contains"),
      text: z.string().optional().describe("Body contains"),
      since: z.string().optional().describe("On or after this date, YYYY-MM-DD"),
      unseen: z.boolean().optional().describe("Only unread messages"),
      limit: z.number().int().min(1).max(100).optional().default(30),
    },
    async ({ folder, from, subject, text, since, unseen, limit }) => {
      const criteria: Record<string, unknown> = {};
      if (from) criteria["from"] = from;
      if (subject) criteria["subject"] = subject;
      if (text) criteria["body"] = text;
      if (since) criteria["since"] = new Date(since);
      if (unseen) criteria["seen"] = false;
      if (Object.keys(criteria).length === 0) criteria["all"] = true;
      return ok(await client.search(folder, criteria, limit));
    },
  );

  server.tool(
    "zoho_campaign_replies",
    "Find likely replies to the Podium email campaigns and rank them. Surfaces messages that " +
      "look like a parent answering: a real person (not an automated bounce or unsubscribe), " +
      "recent, and often containing a grade or a subject. This is the tool that turns opens into leads.",
    {
      sinceDays: z.number().int().min(1).max(90).optional().default(14).describe("Look back this many days"),
      folder: z.string().optional().default("INBOX"),
    },
    async ({ sinceDays, folder }) => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - sinceDays);
      const msgs = await client.search(folder, { since }, 100);

      const scored = msgs
        .map((m) => scoreReply(m))
        .filter((r) => r.isLikelyReply)
        .sort((a, b) => b.score - a.score);

      const summary = {
        window: `${sinceDays} days`,
        scanned: msgs.length,
        likelyReplies: scored.length,
        withGrade: scored.filter((r) => r.hasGrade).length,
        replies: scored.map((r) => ({
          uid: r.mail.uid,
          from: r.mail.from,
          name: r.mail.fromName,
          date: r.mail.date,
          seen: r.mail.seen,
          hasGrade: r.hasGrade,
          hasSubject: r.hasSubject,
          preview: r.mail.preview,
        })),
      };
      return ok(summary);
    },
  );
}

interface Scored {
  mail: MailSummary;
  score: number;
  isLikelyReply: boolean;
  hasGrade: boolean;
  hasSubject: boolean;
}

/**
 * A parent reply is a short, human message from an outside address. Machine
 * traffic (mailer-daemon, no-reply, unsubscribe confirmations) is scored out,
 * and a grade or subject mention pushes a message to the top of the list.
 */
function scoreReply(mail: MailSummary): Scored {
  const from = mail.from.toLowerCase();
  const blob = `${mail.subject} ${mail.preview}`;

  const machine =
    /mailer-daemon|postmaster|no-?reply|notification|unsubscribe|do-?not-?reply|bounce/.test(from) ||
    /delivery status|undeliverable|out of office|automatic reply/i.test(mail.subject);

  const hasGrade = GRADE.test(blob);
  const hasSubject = SUBJECTS.test(blob);
  const isReplySubject = /^re:/i.test(mail.subject) || /my child|grade|tutor/i.test(blob);

  let score = 0;
  if (hasGrade) score += 5;
  if (hasSubject) score += 3;
  if (isReplySubject) score += 2;
  if (!mail.seen) score += 1;
  if (mail.preview.length < 400) score += 1; // short, personal

  return {
    mail,
    score,
    isLikelyReply: !machine && (isReplySubject || hasGrade || hasSubject),
    hasGrade,
    hasSubject,
  };
}
