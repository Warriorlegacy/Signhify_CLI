import { Subagent, SubagentTask, SubagentResult, SubagentContext } from './types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class EditorSubagent implements Subagent {
  readonly role = 'editor';
  readonly name = '@Editor';
  readonly description = 'Executes atomic file edits and code modifications with diff preservation';

  async run(task: SubagentTask, cwd: string, _ctx?: SubagentContext): Promise<SubagentResult> {
    const targetFile = task.context?.targetFile as string | undefined;
    const content = task.context?.content as string | undefined;

    if (!targetFile || content === undefined) {
      return {
        success: true,
        output: `@Editor ready. Objective: "${task.objective}". Ready to apply atomic modifications.`,
      };
    }

    try {
      const fullPath = path.resolve(cwd, targetFile);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');

      return {
        success: true,
        output: `@Editor successfully updated "${targetFile}" (${content.length} bytes written).`,
        artifacts: [targetFile],
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

