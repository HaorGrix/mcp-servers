import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BrevoClient } from '../client.js';
import type {
  BrevoContact,
  BrevoContactsResponse,
  BrevoImportResponse,
  BrevoListsResponse,
} from '../types.js';
import { ok } from './helpers.js';

export function registerContactTools(server: McpServer, client: BrevoClient): void {
  server.tool(
    'brevo_list_lists',
    'List all contact lists with subscriber and blacklist counts',
    {
      limit: z.number().int().min(1).max(50).optional().default(50),
      offset: z.number().int().min(0).optional().default(0),
    },
    async ({ limit, offset }) => ok(await client.get<BrevoListsResponse>('/contacts/lists', { limit, offset })),
  );

  server.tool(
    'brevo_create_list',
    'Create a contact list. Returns the new list id.',
    {
      name: z.string().describe('List name e.g. "podium-partner-priority"'),
      folderId: z.number().int().describe('Folder id. Use brevo_list_folders to find one.'),
    },
    async ({ name, folderId }) => ok(await client.post<{ id: number }>('/contacts/lists', { name, folderId })),
  );

  server.tool(
    'brevo_list_folders',
    'List contact folders. A folderId is required when creating a list.',
    {},
    async () => ok(await client.get<unknown>('/contacts/folders', { limit: 50, offset: 0 })),
  );

  server.tool(
    'brevo_get_contact',
    'Get a single contact by email, including blacklist status and list membership',
    {
      email: z.string().email().describe('Contact email address'),
    },
    async ({ email }) => ok(await client.get<BrevoContact>(`/contacts/${encodeURIComponent(email)}`)),
  );

  server.tool(
    'brevo_list_contacts_in_list',
    'List contacts belonging to a given list id',
    {
      listId: z.number().int().describe('List id'),
      limit: z.number().int().min(1).max(500).optional().default(50),
      offset: z.number().int().min(0).optional().default(0),
    },
    async ({ listId, limit, offset }) =>
      ok(await client.get<BrevoContactsResponse>(`/contacts/lists/${listId}/contacts`, { limit, offset })),
  );

  server.tool(
    'brevo_import_contacts',
    'Bulk import contacts into a list from inline CSV text. Runs asynchronously and returns a processId. ' +
      'The first CSV line must be a header row; an EMAIL column is required.',
    {
      listId: z.number().int().describe('Target list id'),
      csv: z
        .string()
        .describe('CSV body including header row, e.g. "EMAIL;FIRSTNAME\\nabir@x.com;Abir"'),
      updateExisting: z
        .boolean()
        .optional()
        .default(true)
        .describe('Update contacts that already exist rather than skipping them'),
      emptyContactsAttributes: z.boolean().optional().default(false),
    },
    async ({ listId, csv, updateExisting, emptyContactsAttributes }) =>
      ok(
        await client.post<BrevoImportResponse>('/contacts/import', {
          listIds: [listId],
          fileBody: csv,
          updateExistingContacts: updateExisting,
          emptyContactsAttributes,
        }),
      ),
  );

  server.tool(
    'brevo_get_import_status',
    'Check the status of an async contact import by processId',
    {
      processId: z.number().int().describe('processId returned by brevo_import_contacts'),
    },
    async ({ processId }) => ok(await client.get<unknown>(`/processes/${processId}`)),
  );

  server.tool(
    'brevo_blacklist_contact',
    'Blacklist a contact so no campaign can ever email them again. Use for complaints and opt-outs.',
    {
      email: z.string().email().describe('Contact email to blacklist'),
    },
    async ({ email }) => {
      await client.put<void>(`/contacts/${encodeURIComponent(email)}`, { emailBlacklisted: true });
      return ok(`Blacklisted ${email}. No future campaign will send to this address.`);
    },
  );
}
