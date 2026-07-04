import { ToolHandler } from './tool-handler.js';
import simpleGit, { SimpleGit } from 'simple-git';

function getGit(workingDirectory: string): SimpleGit {
  return simpleGit(workingDirectory);
}

export const gitTool: ToolHandler = {
  name: 'git',
  description: 'Perform git operations: status, diff, commit, branch, log',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'diff', 'commit', 'branch', 'log', 'add'],
        description: 'The git action to perform',
      },
      message: { type: 'string', description: 'Commit message (for commit action)' },
      files: { type: 'array', items: { type: 'string' }, description: 'Files to add (for add action)' },
      branch: { type: 'string', description: 'Branch name (for branch action)' },
    },
    required: ['action'],
  },

  async execute(args, context) {
    const git = getGit(context.workingDirectory);
    const action = args.action as string;

    try {
      switch (action) {
        case 'status': {
          const status = await git.status();
          return JSON.stringify({
            current: status.current,
            tracking: status.tracking,
            staged: status.staged,
            modified: status.modified,
            not_added: status.not_added,
            conflicted: status.conflicted,
            ahead: status.ahead,
            behind: status.behind,
          });
        }

        case 'diff': {
          const diff = await git.diff();
          return JSON.stringify({ diff });
        }

        case 'add': {
          const files = (args.files as string[]) ?? ['.'];
          await git.add(files);
          return JSON.stringify({ success: true, added: files });
        }

        case 'commit': {
          const message = args.message as string;
          if (!message) return JSON.stringify({ error: 'Commit message is required' });
          const result = await git.commit(message);
          return JSON.stringify({ success: true, commit: result.commit, summary: result.summary });
        }

        case 'branch': {
          const branch = args.branch as string;
          if (branch) {
            await git.checkout(['-b', branch]);
            return JSON.stringify({ success: true, created: branch });
          }
          const branches = await git.branchLocal();
          return JSON.stringify({ branches: branches.all, current: branches.current });
        }

        case 'log': {
          const log = await git.log({ maxCount: 20 });
          return JSON.stringify({
            commits: log.all.map(c => ({
              hash: c.hash.slice(0, 8),
              message: c.message,
              author: c.author_name,
              date: c.date,
            })),
          });
        }

        default:
          return JSON.stringify({ error: `Unknown git action: ${action}` });
      }
    } catch (error) {
      return JSON.stringify({ error: `Git error: ${error instanceof Error ? error.message : String(error)}` });
    }
  },
};
