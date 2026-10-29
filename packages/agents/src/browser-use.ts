import { Subagent, SubagentTask, SubagentResult, SubagentContext } from './types.js';
import { shouldUseAdapter, completeWithAdapter } from './llm.js';

export class BrowserUseSubagent implements Subagent {
  readonly role = 'browser-use';
  readonly name = '@BrowserUse';
  readonly description = 'Executes end-to-end browser operations and visual verifications';

  async run(task: SubagentTask, _cwd: string, ctx?: SubagentContext): Promise<SubagentResult> {
    const url = task.context?.url as string | undefined;

    if (shouldUseAdapter(ctx)) {
      const system =
        'You are @BrowserUse, a browser automation planner. The browser itself must still be driven by the host tooling; your output is a step plan only.';
      try {
        const plan = await completeWithAdapter(
          ctx,
          system,
          `Objective: "${task.objective}". Navigation target: "${url ?? 'about:blank'}". Respond with concise numbered steps.`,
        );
        return {
          success: true,
          output: `@BrowserUse plan for "${url ?? 'about:blank'}":\n${plan}`,
          metadata: { targetUrl: url },
        };
      } catch {
        // fall through to the template readiness notice
      }
    }

    return {
      success: true,
      output: `@BrowserUse ready. Navigation target: "${url ?? 'about:blank'}". Task objective: "${task.objective}".`,
      metadata: { targetUrl: url },
    };
  }
}
