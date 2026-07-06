import { z } from 'zod';
import { CpanelClient } from '../client.js';
import type { CPFile } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerFileTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_list_files',
    'List files and directories in a cPanel directory',
    {
      dir: z.string().default('/').describe('Directory path relative to home e.g. "/public_html"'),
      show_hidden: z.boolean().optional().default(false).describe('Include hidden (dot) files'),
    },
    async ({ dir, show_hidden }) => {
      const data = await client.call<CPFile[]>('Fileman', 'list_files', {
        dir,
        show_hidden: show_hidden ? 1 : 0,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_read_file',
    'Read the content of a file in cPanel',
    {
      file: z.string().describe('Absolute path from home e.g. "/public_html/wp-config.php"'),
    },
    async ({ file }) => {
      // UAPI get_file_content requires dir + file split, not a combined path.
      const clean = file.replace(/\/+$/, '');
      const idx = clean.lastIndexOf('/');
      const dir = idx <= 0 ? '/' : clean.slice(0, idx);
      const name = clean.slice(idx + 1);
      const data = await client.call<{ content: string; charset: string }>(
        'Fileman',
        'get_file_content',
        { dir, file: name },
      );
      return { content: [{ type: 'text', text: data.content }] };
    },
  );

  server.tool(
    'cp_create_dir',
    'Create a directory in cPanel',
    {
      path: z.string().describe('Path of directory to create e.g. "/public_html/new-folder"'),
    },
    async ({ path }) => {
      await client.createDir(path);
      return { content: [{ type: 'text', text: `Directory created: ${path}` }] };
    },
  );

  server.tool(
    'cp_write_file',
    'Write or overwrite the content of a file in cPanel',
    {
      dir: z.string().describe('Absolute directory path e.g. "/public_html/wp-content/themes/custom"'),
      file: z.string().describe('Filename e.g. "style.css"'),
      content: z.string().describe('The content to write to the file'),
    },
    async ({ dir, file, content }) => {
      await client.post('Fileman', 'save_file_content', {
        dir,
        file,
        content,
      });
      return { content: [{ type: 'text', text: `File saved successfully: ${dir}/${file}` }] };
    },
  );

  server.tool(
    'cp_delete_file',
    'Delete a file or directory in cPanel (moves to trash first)',
    {
      path: z.string().describe('Path to file or directory to delete'),
      skip_trash: z.boolean().optional().default(false).describe('If true, permanently delete'),
    },
    async ({ path, skip_trash }) => {
      await client.post('Fileman', 'unlink', {
        path,
        ...(skip_trash ? { skip_trash: 1 } : {}),
      });
      return { content: [{ type: 'text', text: `Deleted: ${path}` }] };
    },
  );

  server.tool(
    'cp_rename_file',
    'Rename or move a file/directory in cPanel',
    {
      from_path: z.string().describe('Current path'),
      to_path: z.string().describe('New path (rename or move destination)'),
    },
    async ({ from_path, to_path }) => {
      await client.post('Fileman', 'rename', { from_path, to_path });
      return { content: [{ type: 'text', text: `Renamed: ${from_path} → ${to_path}` }] };
    },
  );

  server.tool(
    'cp_compress',
    'Compress files/directories into an archive in cPanel',
    {
      files: z.array(z.string()).describe('List of paths to compress'),
      dest: z.string().describe('Destination archive path e.g. "/public_html/archive.zip"'),
      type: z.enum(['zip', 'tar', 'tar-bzip2', 'tar-gzip']).optional().default('zip'),
    },
    async ({ files, dest, type }) => {
      await client.post('Fileman', 'compress', {
        files: files.join('|'),
        dest,
        type,
      });
      return { content: [{ type: 'text', text: `Compressed to: ${dest}` }] };
    },
  );

  server.tool(
    'cp_extract',
    'Extract an archive in cPanel',
    {
      file: z.string().describe('Path to the archive file'),
      dest: z.string().describe('Destination directory for extraction'),
    },
    async ({ file, dest }) => {
      await client.post('Fileman', 'extract', { file, dest });
      return { content: [{ type: 'text', text: `Extracted ${file} to ${dest}` }] };
    },
  );
}
