import { ToolHandler } from './tool-handler.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Minimal line diff for the write preview. Not a full Myers implementation:
// it trims the common prefix/suffix and reports the changed middle, which is
// what a reviewer needs to see before an agent overwrites a file.
// shortcut: no intra-line diffing and no move detection; upgrade only if
// previews start misrepresenting real edits.
function summariseDiff(filePath: string, before: string, after: string): string {
  if (before === after) return `(no change to ${filePath})`;

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start++;
  }

  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (endBefore >= start && endAfter >= start && beforeLines[endBefore] === afterLines[endAfter]) {
    endBefore--;
    endAfter--;
  }

  const removed = beforeLines.slice(start, endBefore + 1);
  const added = afterLines.slice(start, endAfter + 1);

  const lines = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ line ${start + 1}: -${removed.length} +${added.length} @@`,
    ...removed.slice(0, 20).map((l) => `- ${l}`),
    ...added.slice(0, 20).map((l) => `+ ${l}`),
  ];

  const overflow = removed.length + added.length > 40;
  if (overflow) lines.push(`… (${removed.length + added.length - 40} more changed lines)`);
  return lines.join('\n');
}

export const fileIoTool: ToolHandler = {
  name: 'file-io',
  description: 'Read, write, or list files and directories',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['read', 'write', 'list'], description: 'The action to perform' },
      path: { type: 'string', description: 'File or directory path (relative to working directory)' },
      content: { type: 'string', description: 'Content to write (only for write action)' },
    },
    required: ['action', 'path'],
  },

  async execute(args, context) {
    const action = args.action as string;
    const targetPath = path.resolve(context.workingDirectory, args.path as string);

    if (!targetPath.startsWith(context.workingDirectory)) {
      return JSON.stringify({ error: 'Path traversal not allowed' });
    }

    switch (action) {
      case 'read': {
        try {
          const content = await fs.readFile(targetPath, 'utf-8');
          return JSON.stringify({ content, path: args.path });
        } catch (error) {
          return JSON.stringify({ error: `Cannot read file: ${error instanceof Error ? error.message : String(error)}` });
        }
      }

      case 'write': {
        try {
          const dir = path.dirname(targetPath);
          await fs.mkdir(dir, { recursive: true });

          // Show what is about to be replaced. New files have no diff.
          let diff: string | undefined;
          const existing = await fs.readFile(targetPath, 'utf-8').catch(() => null);
          if (existing !== null) {
            diff = summariseDiff(args.path as string, existing, args.content as string);
          }

          await fs.writeFile(targetPath, args.content as string, 'utf-8');
          return JSON.stringify({
            success: true,
            path: args.path,
            created: existing === null,
            ...(diff ? { diff } : {}),
          });
        } catch (error) {
          return JSON.stringify({ error: `Cannot write file: ${error instanceof Error ? error.message : String(error)}` });
        }
      }

      case 'list': {
        try {
          const entries = await fs.readdir(targetPath, { withFileTypes: true });
          const items = entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
          }));
          return JSON.stringify({ entries: items, path: args.path });
        } catch (error) {
          return JSON.stringify({ error: `Cannot list directory: ${error instanceof Error ? error.message : String(error)}` });
        }
      }

      default:
        return JSON.stringify({ error: `Unknown action: ${action}` });
    }
  },
};
