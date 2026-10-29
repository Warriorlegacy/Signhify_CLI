import { Subagent, SubagentTask, SubagentResult, SubagentContext, ReviewVerdict } from './types.js';
import { shouldUseAdapter, completeWithAdapter } from './llm.js';

export function parseReviewVerdict(text: string): ReviewVerdict | null {
  if (!text || !text.trim()) return null;
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as Partial<ReviewVerdict>;
    if (typeof parsed?.met === 'boolean') {
      return {
        met: parsed.met,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        remainingSteps: Array.isArray(parsed.remainingSteps) ? parsed.remainingSteps.map(String) : [],
      };
    }
  } catch {
    // not raw JSON
  }
  const match = trimmed.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<ReviewVerdict>;
    if (typeof parsed?.met === 'boolean') {
      return {
        met: parsed.met,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        remainingSteps: Array.isArray(parsed.remainingSteps) ? parsed.remainingSteps.map(String) : [],
      };
    }
  } catch {
    return null;
  }
  return null;
}

export class ReviewerSubagent implements Subagent {
  readonly role = 'reviewer';
  readonly name = '@Reviewer';
  readonly description = 'Executes verification suites, inspects diffs, and validates goal stop conditions';

  async run(task: SubagentTask, _cwd: string, ctx?: SubagentContext): Promise<SubagentResult> {
    if (ctx?.signal?.aborted) {
      return { success: false, output: '', error: 'Subagent cancelled by user' };
    }

    const testCommand =
      task.context?.testCommand === false
        ? undefined
        : (typeof task.context?.testCommand === 'string' ? task.context.testCommand : 'npm test -- --run');

    const instructions =
      (typeof task.context?.instructions === 'string' && task.context.instructions) ||
      task.objective ||
      'Verify implementation against requirements';

    const diff = (typeof task.context?.diff === 'string' && task.context.diff) || '';

    if (testCommand && !ctx?.invokeTool) {
      return { success: false, output: '', error: 'Reviewer commands require the host shell-exec permission pipeline.' };
    }

    let execution: { exitCode?: number; stdout?: string; stderr?: string } = { exitCode: 0, stdout: '', stderr: '' };
    let testError: string | undefined;

    if (testCommand && ctx?.invokeTool) {
      try {
        const result = await ctx.invokeTool('shell-exec', { command: testCommand, timeoutMs: 30_000 });
        if (ctx?.signal?.aborted) {
          return { success: false, output: '', error: 'Subagent cancelled by user' };
        }
        if (result.isError) {
          execution = { exitCode: 1, stderr: result.content };
          testError = result.content;
        } else {
          try {
            execution = JSON.parse(result.content) as { exitCode?: number; stdout?: string; stderr?: string };
          } catch {
            execution = { exitCode: 0, stdout: result.content };
          }
          if (execution.exitCode !== 0) {
            testError = (execution.stderr || execution.stdout || `Command exited with code ${execution.exitCode ?? 'unknown'}`).slice(0, 500);
          }
        }
      } catch (err: unknown) {
        if (ctx?.signal?.aborted) {
          return { success: false, output: '', error: 'Subagent cancelled by user' };
        }
        const errorOutput = err instanceof Error ? err.message : String(err);
        execution = { exitCode: 1, stderr: errorOutput };
        testError = errorOutput;
      }
    }

    let verdict: ReviewVerdict;

    // Check if a structured verdict was explicitly provided in task context (e.g. testing)
    if (task.context?.verdict && typeof task.context.verdict === 'object') {
      const v = task.context.verdict as Partial<ReviewVerdict>;
      verdict = {
        met: v.met ?? false,
        reason: v.reason ?? '',
        remainingSteps: Array.isArray(v.remainingSteps) ? v.remainingSteps.map(String) : [],
        exitCode: execution.exitCode,
      };
    } else if (shouldUseAdapter(ctx)) {
      const system =
        'You are @Reviewer, a verification and code review subagent. Evaluate the changes and test results against the task instructions. ' +
        'Respond with ONLY a JSON object: { "met": boolean, "reason": string, "remainingSteps": string[] }. No markdown fences, no preamble.';
      const user = [
        `Instructions: ${instructions}`,
        testCommand ? `Test Command: ${testCommand}` : '',
        `Test Exit Code: ${execution.exitCode ?? 0}`,
        execution.stdout ? `Test Stdout: ${execution.stdout.slice(0, 500)}` : '',
        execution.stderr ? `Test Stderr: ${execution.stderr.slice(0, 500)}` : '',
        diff ? `Changes/Diff:\n${diff}` : '',
      ].filter(Boolean).join('\n');

      try {
        const reply = await completeWithAdapter(ctx, system, user);
        if (ctx?.signal?.aborted) {
          return { success: false, output: '', error: 'Subagent cancelled by user' };
        }
        const parsedVerdict = parseReviewVerdict(reply);
        if (parsedVerdict) {
          verdict = { ...parsedVerdict, exitCode: execution.exitCode };
        } else {
          verdict = this.defaultVerdict(execution, testError);
        }
      } catch (error) {
        if (ctx?.signal?.aborted) throw error;
        verdict = this.defaultVerdict(execution, testError);
      }
    } else {
      verdict = this.defaultVerdict(execution, testError);
    }

    const stdout = execution.stdout ?? '';
    const stderr = execution.stderr ?? '';
    const statusText = verdict.met ? 'verified: command completed successfully.' : `check failed:\n${verdict.reason}`;

    return {
      success: verdict.met,
      output: `@Reviewer ${statusText}${
        verdict.remainingSteps.length > 0 ? `\nRemaining steps:\n${verdict.remainingSteps.map((s) => `- ${s}`).join('\n')}` : ''
      }${stdout && verdict.met ? `\n\n${stdout.slice(0, 500)}` : ''}`,
      metadata: {
        verdict,
        exitCode: execution.exitCode,
        stdout: stdout.slice(0, 500),
        stderr: stderr.slice(0, 500),
      },
      ...(verdict.met ? {} : { error: verdict.reason }),
    };
  }

  private defaultVerdict(execution: { exitCode?: number; stdout?: string; stderr?: string }, testError?: string): ReviewVerdict {
    if (testError || (execution.exitCode !== undefined && execution.exitCode !== 0)) {
      return {
        met: false,
        reason: testError || `Command exited with code ${execution.exitCode ?? 'unknown'}`,
        remainingSteps: ['Fix failing tests and review issues.'],
        exitCode: execution.exitCode,
      };
    }

    return {
      met: true,
      reason: 'Verification completed successfully against instructions.',
      remainingSteps: [],
      exitCode: execution.exitCode ?? 0,
    };
  }
}

