import { Subagent, SubagentTask, SubagentResult } from './types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class FilePickerSubagent implements Subagent {
  readonly role = 'file-picker';
  readonly name = '@FilePicker';
  readonly description = 'Explores repository layout and discovers minimal relevant files for a coding task';

  async run(task: SubagentTask, cwd: string): Promise<SubagentResult> {
    const matchedFiles: string[] = [];
    const query = (task.objective || '').toLowerCase();
    const keywords = query.split(/\s+/).filter(k => k.length > 2);

    try {
      const walk = async (dir: string, depth = 0): Promise<void> => {
        if (depth > 4) return;
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (
            entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'dist' ||
            entry.name === 'coverage'
          ) {
            continue;
          }

          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(cwd, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            await walk(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const lowerName = entry.name.toLowerCase();
            const lowerPath = relPath.toLowerCase();

            const isRelevant = keywords.some(
              kw => lowerName.includes(kw) || lowerPath.includes(kw)
            );

            if (isRelevant || matchedFiles.length < 5) {
              matchedFiles.push(relPath);
            }
          }
        }
      };

      await walk(cwd);

      const relevant = matchedFiles.slice(0, 15);
      return {
        success: true,
        output: relevant.length > 0
          ? `Discovered ${relevant.length} relevant file(s):\n${relevant.map(f => `- ${f}`).join('\n')}`
          : 'No specific matching files found in repository.',
        artifacts: relevant,
      };
    } catch (err: unknown) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

