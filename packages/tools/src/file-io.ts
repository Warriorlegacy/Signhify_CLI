import { ToolHandler } from './tool-handler.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

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
          await fs.writeFile(targetPath, args.content as string, 'utf-8');
          return JSON.stringify({ success: true, path: args.path });
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
