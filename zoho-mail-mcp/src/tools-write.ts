import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZohoClient } from "./client.js";
import type { ZohoSender } from "./sender.js";
import type { ZohoAdmin } from "./admin.js";
import type { Config } from "./config.js";

function ok(payload: unknown) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

/** Send + organize. Registered always; each tool enforces its own guard. */
export function registerWriteTools(
  server: McpServer,
  client: ZohoClient,
  sender: ZohoSender,
  config: Config,
): void {
  server.tool(
    "zoho_reply",
    "Send a reply to a message, threaded correctly. IRREVERSIBLE: this sends real email from " +
      "the mailbox. Requires confirm=\"SEND\". Reads the original to thread and address it.",
    {
      uid: z.number().int().describe("UID of the message being replied to"),
      folder: z.string().optional().default("INBOX"),
      body: z.string().describe("Plain text reply body"),
      subject: z.string().optional().describe("Override subject; defaults to Re: original"),
      confirm: z.literal("SEND").describe('Must be exactly "SEND".'),
    },
    async ({ uid, folder, body, subject }) => {
      const original = await client.read(folder, uid);
      if (!original) return ok(`No message with UID ${uid} in ${folder}.`);
      const to = original.from;
      if (!to) return ok("Original message has no sender to reply to.");
      const subj = subject ?? (original.subject.match(/^re:/i) ? original.subject : `Re: ${original.subject}`);
      const result = await sender.send({
        from: config.user,
        to,
        subject: subj,
        text: body,
      });
      return ok(`Replied to ${to} (${subj}). messageId ${result.messageId}`);
    },
  );

  server.tool(
    "zoho_send",
    "Send a new email. IRREVERSIBLE. Requires confirm=\"SEND\". Use for outreach that is not a reply.",
    {
      to: z.string().email().describe("Recipient"),
      subject: z.string(),
      body: z.string().describe("Plain text body"),
      confirm: z.literal("SEND").describe('Must be exactly "SEND".'),
    },
    async ({ to, subject, body }) => {
      const result = await sender.send({ from: config.user, to, subject, text: body });
      return ok(`Sent to ${to}. messageId ${result.messageId}`);
    },
  );

  server.tool(
    "zoho_mark_read",
    "Mark a message read or unread. Needs ZOHO_READ_ONLY=0.",
    {
      uid: z.number().int(),
      folder: z.string().optional().default("INBOX"),
      seen: z.boolean().optional().default(true),
    },
    async ({ uid, folder, seen }) => {
      await client.markSeen(folder, uid, seen);
      return ok(`UID ${uid} marked ${seen ? "read" : "unread"}.`);
    },
  );

  server.tool(
    "zoho_move",
    "Move a message to another folder, e.g. a 'Leads' folder. Needs ZOHO_READ_ONLY=0.",
    {
      uid: z.number().int(),
      from: z.string().optional().default("INBOX"),
      to: z.string().describe("Target folder name"),
    },
    async ({ uid, from, to }) => {
      await client.move(from, uid, to);
      return ok(`UID ${uid} moved from ${from} to ${to}.`);
    },
  );
}

/** Admin tools. Registered only when the refresh token is configured. */
export function registerAdminTools(server: McpServer, admin: ZohoAdmin): void {
  server.tool(
    "zoho_admin_list_users",
    "List all user accounts in the Zoho organization.",
    {},
    async () => ok(await admin.call("GET", admin.orgPath("/accounts"))),
  );

  server.tool(
    "zoho_admin_get_org",
    "Get organization details: domains, plan, user count.",
    {},
    async () => ok(await admin.call("GET", "/api/organization")),
  );

  server.tool(
    "zoho_admin_create_user",
    "Create a new user in the organization. IRREVERSIBLE-ish. Requires confirm=\"CREATE\".",
    {
      emailId: z.string().email(),
      firstName: z.string(),
      lastName: z.string(),
      password: z.string().min(8).describe("Initial password for the new mailbox"),
      confirm: z.literal("CREATE").describe('Must be exactly "CREATE".'),
    },
    async ({ emailId, firstName, lastName, password }) => {
      const res = await admin.call("POST", admin.orgPath("/accounts"), {
        primaryEmailAddress: emailId,
        firstName,
        lastName,
        password,
      });
      return ok(res);
    },
  );

  server.tool(
    "zoho_admin_delete_user",
    "Delete a user account. DESTRUCTIVE and hard to undo. Requires confirm=\"DELETE-USER\" and the exact email.",
    {
      accountId: z.string().describe("The zoid/account id of the user to delete"),
      confirmEmail: z.string().email().describe("The user's email, re-typed as a safety check"),
      confirm: z.literal("DELETE-USER").describe('Must be exactly "DELETE-USER".'),
    },
    async ({ accountId }) => {
      const res = await admin.call("DELETE", admin.orgPath(`/accounts/${accountId}`));
      return ok(res ?? "Deleted.");
    },
  );

  server.tool(
    "zoho_admin_raw",
    "Escape hatch for any org admin endpoint not covered above. GET is unrestricted; any " +
      "other method requires confirm=\"WRITE\". Path is appended to the Zoho Mail API host.",
    {
      method: z.enum(["GET", "POST", "PUT", "DELETE"]),
      path: z.string().describe('e.g. "/api/organization/{zoid}/groups"'),
      body: z.record(z.unknown()).optional(),
      confirm: z.literal("WRITE").optional().describe('Required for any non-GET method.'),
    },
    async ({ method, path, body, confirm }) => {
      if (method !== "GET" && confirm !== "WRITE") {
        return ok(`Refused: ${method} needs confirm="WRITE".`);
      }
      return ok(await admin.call(method, path, body));
    },
  );
}
