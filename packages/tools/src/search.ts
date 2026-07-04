import { ToolHandler } from './tool-handler.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface MatchResult {
  file: string;
  line: number;
  text: string;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function walkFiles(dir: string, include?: string): Promise<string[]> {
  const results: string[] = [];
  let entries: { name: string; isDirectory(): boolean }[] = [];
  try {
    const raw = await fs.readdir(dir, { withFileTypes: true });
    entries = raw.filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist');
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkFiles(fullPath, include));
    } else if (!include || entry.name.match(include.replace('*', '.*')) || entry.name === include) {
      results.push(fullPath);
    }
  }
  return results;
}

async function grepInFiles(
  baseDir: string,
  pattern: string,
  include?: string,
  limit = 100
): Promise<{ matches: string[]; count: number }> {
  const regex = new RegExp(pattern);
  const files = await walkFiles(baseDir, include);
  const matches: string[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const relative = path.relative(baseDir, file);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && matches.length < limit; i++) {
        if (regex.test(lines[i])) {
          matches.push(`${relative}:${i + 1}: ${lines[i]}`);
        }
      }
    } catch {
      // skip unreadable file
    }
  }

  return { matches: matches.slice(0, limit), count: matches.length };
}

async function findFiles(
  baseDir: string,
  pattern: string,
  include?: string,
  limit = 50
): Promise<{ files: string[]; count: number }> {
  const regex = new RegExp(escapeRegex(pattern));
  const files = await walkFiles(baseDir, include);
  const filtered = files
    .map(f => path.relative(baseDir, f))
    .filter(f => regex.test(f.split(/[\\/]/).pop() ?? f))
    .slice(0, limit);

  return { files: filtered, count: filtered.length };
}

export const searchTool: ToolHandler = {
  name: 'search',
  description: 'Search file contents using regex patterns or find files by name',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['grep', 'find'], description: 'Search type' },
      pattern: { type: 'string', description: 'Regex pattern or file glob' },
      path: { type: 'string', description: 'Directory to search in (relative to working directory)' },
      include: { type: 'string', description: 'File pattern to include (e.g., *.ts)' },
    },
    required: ['action', 'pattern'],
  },

  async execute(args, context) {
    const action = args.action as string;
    const pattern = args.pattern as string;
    const searchPath = path.resolve(context.workingDirectory, (args.path as string) ?? '.');
    const include = args.include as string | undefined;

    try {
      switch (action) {
        case 'grep': {
          const result = await grepInFiles(searchPath, pattern, include);
          return JSON.stringify({ matches: result.matches, count: result.count });
        }

        case 'find': {
          const result = await findFiles(searchPath, pattern, include);
          return JSON.stringify({ files: result.files, count: result.count });
        }

        default:
          return JSON.stringify({ error: `Unknown search action: ${action}` });
      }
    } catch (error) {
      return JSON.stringify({ error: `Search error: ${error instanceof Error ? error.message : String(error)}` });
    }
  },
};
