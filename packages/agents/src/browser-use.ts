import { Subagent, SubagentTask, SubagentResult } from './types.js';

export class BrowserUseSubagent implements Subagent {
  readonly role = 'browser-use';
  readonly name = '@BrowserUse';
  readonly description = 'Executes end-to-end browser operations and visual verifications';

  async run(task: SubagentTask): Promise<SubagentResult> {
    const url = task.context?.url as string | undefined;

    return {
      success: true,
      output: `@BrowserUse ready. Navigation target: "${url ?? 'about:blank'}". Task objective: "${task.objective}".`,
      metadata: { targetUrl: url },
    };
  }
}

