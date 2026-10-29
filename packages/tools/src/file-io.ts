import { ToolHandler } from './tool-handler.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DiffSummary {
  text: string;
  truncated: boolean;
  additions: number;
  deletions: number;
}

// Minimal line diff for the write preview. Not a full Myers implementation:
// it trims the common prefix/suffix and reports the changed middle, which is
// what a reviewer needs to see before an agent overwrites a file.
// shortcut: no intra-line diffing and no move detection; upgrade only if
// previews start misrepresenting real edits.
export function summariseDiff(filePath: string, before: string, after: string): DiffSummary {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normBefore = before.replace(/\r\n/g, '\n');
  const normAfter = after.replace(/\r\n/g, '\n');

  if (normBefore === normAfter) {
    return { text: `(no change to ${normalizedPath})`, truncated: false, additions: 0, deletions: 0 };
  }

  const beforeLines = normBefore ? normBefore.split('\n') : [];
  const afterLines = normAfter ? normAfter.split('\n') : [];

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
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    `@@ line ${start + 1}: -${removed.length} +${added.length} @@`,
    ...removed.slice(0, 20).map((l) => `- ${l}`),
    ...added.slice(0, 20).map((l) => `+ ${l}`),
  ];

  const overflow = removed.length + added.length > 40;
  if (overflow) lines.push(`… (${removed.length + added.length - 40} more changed lines)`);
  return {
    text: lines.join('\n'),
    truncated: overflow,
    additions: added.length,
    deletions: removed.length,
  };
}

export function generateDiffPreview(filePath: string, before: string, after: string): DiffSummary {
  return summariseDiff(filePath, before, after);
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveWorkspacePath(workingDirectory: string, requestedPath: string): Promise<string> {
  const root = await fs.realpath(workingDirectory);
  const target = path.resolve(root, requestedPath);
  if (!isWithin(root, target)) throw new Error('Path traversal not allowed');

  // shortcut: this checks existing symlinks but cannot prevent a hostile process swapping them during I/O; use directory-handle-relative operations if concurrent hostile writes become in scope.
  let existing = target;
  while (existing.length > 0) {
    try {
      const real = await fs.realpath(existing);
      if (!isWithin(root, real)) throw new Error('Path traversal not allowed');
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        if ((await fs.lstat(existing)).isSymbolicLink()) throw new Error('Path traversal not allowed');
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
      }
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error('Path traversal not allowed');
      existing = parent;
    }
  }
  return target;
}

export async function previewWrite(args: Record<string, unknown>, workingDirectory: string): Promise<string> {
  if (typeof args.path !== 'string' || typeof args.content !== 'string') {
    throw new Error('Write requires a path and string content');
  }
  const targetPath = await resolveWorkspacePath(workingDirectory, args.path);
  const existing = await fs.readFile(targetPath, 'utf-8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const diff = summariseDiff(args.path, existing ?? '', args.content);
  // shortcut: refuse changes too large to show fully; remove this limit when the TUI can page a complete diff.
  if (diff.truncated || diff.text.length > 20_000) {
    throw new Error('Change is too large to review in one prompt. Split it into smaller file writes.');
  }
  return `${existing === null ? `Create ${args.path}` : `Update ${args.path}`}\n${diff.text}`;
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

  async preview(args, context) {
    if (args.action === 'write' || (!args.action && typeof args.content === 'string')) {
      return previewWrite(args, context.workingDirectory);
    }
    return '';
  },

  async execute(args, context) {
    const action = args.action as string;
    if (typeof args.path !== 'string') return JSON.stringify({ error: 'Path is required' });

    switch (action) {
      case 'read': {
        try {
          const targetPath = await resolveWorkspacePath(context.workingDirectory, args.path);
          const content = await fs.readFile(targetPath, 'utf-8');
          return JSON.stringify({ content, path: args.path });
        } catch (error) {
          return JSON.stringify({ error: `Cannot read file: ${error instanceof Error ? error.message : String(error)}` });
        }
      }

      case 'write': {
        try {
          if (typeof args.content !== 'string') return JSON.stringify({ error: 'Content must be a string' });
          if (!context.autoMode) {
            if (context.consentGranted !== true || context.approvedPreview === undefined) {
              return JSON.stringify({ error: 'File write denied: explicit preview approval is required' });
            }
            if (await previewWrite(args, context.workingDirectory) !== context.approvedPreview) {
              return JSON.stringify({ error: 'File changed after approval. Review the current diff and try again.' });
            }
          }
          let targetPath = await resolveWorkspacePath(context.workingDirectory, args.path);
          const dir = path.dirname(targetPath);
          await fs.mkdir(dir, { recursive: true });
          targetPath = await resolveWorkspacePath(context.workingDirectory, args.path);
          if (!context.autoMode && await previewWrite(args, context.workingDirectory) !== context.approvedPreview) {
            return JSON.stringify({ error: 'File changed after approval. Review the current diff and try again.' });
          }

          let diff: string | undefined;
          let additions: number | undefined;
          let deletions: number | undefined;
          const existing = await fs.readFile(targetPath, 'utf-8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (existing !== null) {
            const summary = summariseDiff(args.path, existing, args.content);
            diff = summary.text;
            additions = summary.additions;
            deletions = summary.deletions;
          }

          await fs.writeFile(targetPath, args.content, 'utf-8');
          return JSON.stringify({
            success: true,
            path: args.path,
            created: existing === null,
            ...(diff ? { diff, additions, deletions } : {}),
          });
        } catch (error) {
          return JSON.stringify({ error: `Cannot write file: ${error instanceof Error ? error.message : String(error)}` });
        }
      }

      case 'list': {
        try {
          const targetPath = await resolveWorkspacePath(context.workingDirectory, args.path);
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
