import { SignhifyConfig, AgentLoop, Goal } from '@signhify/core';
import { createAdapter } from '@signhify/providers';
import { fileIoTool, shellExecTool, gitTool, searchTool, browserTool, mcpClientTool } from '@signhify/tools';
import { MemoryStore, CheckpointWriter, MemoryMdManager } from '@signhify/memory';
import * as path from 'node:path';

interface RunOptions {
  auto: boolean;
  output: 'json' | 'text';
  mode: string;
}

interface RunResult {
  success: boolean;
  task: string;
  mode: string;
  auto: boolean;
  toolCalls: number;
  messages: number;
  goalMet?: boolean;
  goalVerdict?: import('@signhify/core').GoalVerdict;
  error?: string;
  exitCode: number;
}

export async function runNonInteractive(
  task: string,
  config: SignhifyConfig,
  options: RunOptions
): Promise<void> {
  const startTime = Date.now();
  const cwd = process.cwd();

  try {
    const memoryMd = new MemoryMdManager(cwd);
    const memoryStore = new MemoryStore(path.join(cwd, '.signhify', 'memory.db'));
    const checkpointWriter = new CheckpointWriter(memoryStore, cwd);

    const [memContent, checkpoint] = await Promise.all([
      memoryMd.readMemoryMd(),
      checkpointWriter.readLatestCheckpoint(),
    ]);

    let checkpointContent = '';
    let taskProgress = '';
    if (checkpoint) {
      const parts: string[] = [];
      if (checkpoint.summary) parts.push(`## Previous Session Summary\n${checkpoint.summary}`);
      if (checkpoint.sections.decisions.length) parts.push(`## Decisions\n${checkpoint.sections.decisions.map(d => `- ${d}`).join('\n')}`);
      if (checkpoint.sections.openIssues.length) parts.push(`## Open Issues\n${checkpoint.sections.openIssues.map(i => `- ${i}`).join('\n')}`);
      checkpointContent = parts.join('\n\n');
      taskProgress = checkpoint.sections.taskProgress;
    }

    const adapter = createAdapter(config.provider.agent);
    const loop = new AgentLoop({
      config,
      workingDirectory: cwd,
      provider: adapter,
      autoMode: options.auto,
      memoryContent: memContent || undefined,
      checkpointContent: checkpointContent || undefined,
      taskProgress: taskProgress || undefined,
      onCheckpoint: (sessionId, usage) => {
        if (options.output === 'json') {
          console.log(JSON.stringify({ event: 'checkpoint', sessionId, tokenUsage: usage }), null, 2);
        }
      },
    });

    // Register tools
    loop.registerTool(fileIoTool);
    loop.registerTool(shellExecTool);
    loop.registerTool(gitTool);
    loop.registerTool(searchTool);
    loop.registerTool(browserTool);
    loop.registerTool(mcpClientTool);

    // Set mode
    loop.getModeManager().setMode(options.mode as 'build' | 'plan' | 'debug' | 'compose');

    const result = await loop.run(task);
    const elapsed = Date.now() - startTime;

    const goalNotMet = result.goalMet === false && result.error?.includes('Max iterations');
    const runResult: RunResult = {
      success: result.success,
      task,
      mode: options.mode,
      auto: options.auto,
      toolCalls: result.toolCalls.length,
      messages: result.messages.length,
      goalMet: result.goalMet,
      goalVerdict: result.goalVerdict,
      error: result.error,
      exitCode: goalNotMet ? 2 : result.success ? 0 : 1,
    };

    if (options.output === 'json') {
      console.log(JSON.stringify({ ...runResult, elapsedMs: elapsed }, null, 2));
    } else {
      if (result.success) {
        console.log(`Task completed successfully in ${(elapsed / 1000).toFixed(1)}s`);
        console.log(`Tool calls: ${result.toolCalls.length}`);
      } else {
        console.error(`Task failed: ${result.error ?? 'Unknown error'}`);
      }
    }

    process.exit(runResult.exitCode);
  } catch (error) {
    const runResult: RunResult = {
      success: false,
      task,
      mode: options.mode,
      auto: options.auto,
      toolCalls: 0,
      messages: 0,
      error: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };

    if (options.output === 'json') {
      console.log(JSON.stringify(runResult, null, 2));
    } else {
      console.error(`Fatal error: ${runResult.error}`);
    }

    process.exit(1);
  }
}
