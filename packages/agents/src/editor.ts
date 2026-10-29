import { Subagent, SubagentTask, SubagentResult, SubagentContext } from './types.js';

export class EditorSubagent implements Subagent {
  readonly role = 'editor';
  readonly name = '@Editor';
  readonly description = 'Executes atomic file edits and code modifications with diff preservation';

  async run(task: SubagentTask, _cwd: string, ctx?: SubagentContext): Promise<SubagentResult> {
    if (ctx?.signal?.aborted) {
      return { success: false, output: '', error: 'Subagent cancelled by user' };
    }

    const targetFile = task.context?.targetFile as string | undefined;
    const content = task.context?.content as string | undefined;

    if (targetFile === undefined && content === undefined) {
      return {
        success: true,
        output: `@Editor ready. Objective: "${task.objective}". Supply targetFile and content to apply an edit.`,
      };
    }
    if (!targetFile || content === undefined) {
      return { success: false, output: '', error: 'Both targetFile and content are required for an edit.' };
    }
    if (!ctx?.invokeTool) {
      return { success: false, output: '', error: 'Editor writes require the host file-io permission pipeline.' };
    }

    try {
      const result = await ctx.invokeTool('file-io', { action: 'write', path: targetFile, content });
      if (ctx?.signal?.aborted) {
        return { success: false, output: '', error: 'Subagent cancelled by user' };
      }
      if (result.isError) return { success: false, output: result.content, error: result.content };
      let write: { success?: boolean; error?: string };
      try {
        write = JSON.parse(result.content) as { success?: boolean; error?: string };
      } catch {
        write = { success: true };
      }
      if (write.success !== true) {
        return { success: false, output: result.content, error: write.error ?? 'The host rejected the file write.' };
      }

      // Closed-loop verification step
      const testCommand =
        (typeof task.context?.testCommand === 'string' && task.context.testCommand) ||
        (typeof task.context?.verifyStep === 'string' && task.context.verifyStep) ||
        (task.context?.verifyStep === true ? 'npm test -- --run' : undefined);

      if (testCommand) {
        if (ctx.signal?.aborted) {
          return {
            success: false,
            output: `@Editor applied file write for "${targetFile}", but execution was cancelled before verification.`,
            artifacts: [targetFile],
            error: 'Subagent cancelled by user',
          };
        }

        const testResult = await ctx.invokeTool('shell-exec', { command: testCommand, timeoutMs: 30_000 });
        if (ctx.signal?.aborted) {
          return {
            success: false,
            output: `@Editor applied file write for "${targetFile}", but execution was cancelled during verification.`,
            artifacts: [targetFile],
            error: 'Subagent cancelled by user',
          };
        }

        if (testResult.isError) {
          return {
            success: false,
            output: `@Editor applied file write for "${targetFile}", but verification failed (${testCommand}):\n${testResult.content}`,
            artifacts: [targetFile],
            error: testResult.content,
            metadata: {
              targetFile,
              verified: false,
              testCommand,
              isError: true,
            },
          };
        }

        let execution: { exitCode?: number; stdout?: string; stderr?: string };
        try {
          execution = JSON.parse(testResult.content) as { exitCode?: number; stdout?: string; stderr?: string };
        } catch {
          execution = { exitCode: 0, stdout: testResult.content };
        }

        const stdout = execution.stdout ?? '';
        const stderr = execution.stderr ?? '';
        if (execution.exitCode !== 0) {
          const errorMsg = (stderr || stdout || `Command exited with code ${execution.exitCode ?? 'unknown'}`).slice(0, 500);
          return {
            success: false,
            output: `@Editor applied file write for "${targetFile}", but verification failed (${testCommand}):\n${errorMsg}`,
            artifacts: [targetFile],
            error: errorMsg,
            metadata: {
              targetFile,
              verified: false,
              testCommand,
              exitCode: execution.exitCode,
              stdout: stdout.slice(0, 500),
              stderr: stderr.slice(0, 500),
            },
          };
        }

        return {
          success: true,
          output: `@Editor applied file write for "${targetFile}" and verification passed (${testCommand}).\n${stdout.slice(0, 500)}`,
          artifacts: [targetFile],
          metadata: {
            targetFile,
            verified: true,
            testCommand,
            exitCode: execution.exitCode,
            stdout: stdout.slice(0, 500),
          },
        };
      }

      return {
        success: true,
        output: `@Editor applied the host-approved file write for "${targetFile}". ${result.content}`,
        artifacts: [targetFile],
        metadata: {
          targetFile,
          verified: false,
        },
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

