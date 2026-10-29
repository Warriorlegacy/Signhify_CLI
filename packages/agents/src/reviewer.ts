import { Subagent, SubagentTask, SubagentResult, SubagentContext } from './types.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class ReviewerSubagent implements Subagent {
  readonly role = 'reviewer';
  readonly name = '@Reviewer';
  readonly description = 'Executes verification suites, inspects diffs, and validates goal stop conditions';

  async run(task: SubagentTask, cwd: string, _ctx?: SubagentContext): Promise<SubagentResult> {
    const testCommand = (task.context?.testCommand as string) || 'npm test -- --run';

    try {
      const { stdout, stderr } = await execAsync(testCommand, {
        cwd,
        timeout: 30_000,
      });

      return {
        success: true,
        output: `@Reviewer verified: Tests passed successfully.\n\n${stdout.slice(0, 500)}`,
        metadata: { stdout, stderr },
      };
    } catch (err: unknown) {
      const errorOutput = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: `@Reviewer check failed:\n${errorOutput.slice(0, 500)}`,
        error: errorOutput,
      };
    }
  }
}

