import { AgentLoop, loadProjectInstructions, type SignhifyConfig, type ToolCall } from '@signhify/core';
import { createAdapter, FallbackRouter, DEFAULT_ZERO_COST_CHAIN, type FallbackEvent, type StreamChunk } from '@signhify/providers';
import { fileIoTool, shellExecTool, gitTool, searchTool, browserTool, mcpClientTool, subagentTool, configureSubagents, configureMcpServers, disconnectAllMcpServers } from '@signhify/tools';
import { MemoryStore, CheckpointWriter, MemoryMdManager } from '@signhify/memory';
import { resolveApiKeyRef } from './config.js';
import * as path from 'node:path';

export interface RunOptions {
  auto: boolean;
  output: 'json' | 'text' | 'quiet';
  mode: string;
  resume?: string;
  signal?: AbortSignal;
  confirm?: (message: string) => Promise<boolean>;
  onStream?: (chunk: StreamChunk) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (toolCallId: string, result: string, isError?: boolean) => void;
}

export interface RunResult {
  success: boolean;
  cancelled?: boolean;
  task: string;
  mode: string;
  auto: boolean;
  sessionId?: string;
  toolCalls: number;
  messages: number;
  answer?: string;
  goalMet?: boolean;
  goalVerdict?: import('@signhify/core').GoalVerdict;
  error?: string;
  exitCode: number;
  elapsedMs: number;
}

export async function runNonInteractive(
  task: string,
  config: SignhifyConfig,
  options: RunOptions
): Promise<RunResult> {
  const startTime = Date.now();
  const cwd = process.cwd();
  let usageTokens = 0;
  let memoryStore: MemoryStore | undefined;

  try {
    const projectInstructions = await loadProjectInstructions(cwd, config.memory?.tokenBudget);
    const memoryMd = new MemoryMdManager(cwd);
    memoryStore = new MemoryStore(path.join(cwd, '.signhify', 'memory.db'));
    const checkpointWriter = new CheckpointWriter(memoryStore, cwd);

    // Session registry (T3.3): every run registers a row; --resume re-touches
    // the same row so checkpoints keep linking to one id.
    const sessionId = memoryStore.createSession(cwd, options.resume);

    const memContent = await memoryMd.readMemoryMd();

    let checkpointContent = '';
    let taskProgress = '';
    if (options.resume) {
      // Scoped resume: only this session's checkpoint — the latest file may
      // belong to a different session.
      const resumed = memoryStore.getCheckpointBySession(options.resume);
      if (resumed) {
        checkpointContent = `## Previous Session Summary\n${resumed.summary}`;
        console.error(`[resume] loaded checkpoint for ${options.resume} (${resumed.createdAt} @ ${resumed.tokenUsageAtCheckpoint} tokens)`);
      } else {
        console.error(`[resume] session ${options.resume} has no checkpoint; starting clean`);
      }
    } else {
      const checkpoint = await checkpointWriter.readLatestCheckpoint();
      if (checkpoint) {
        const parts: string[] = [];
        if (checkpoint.summary) parts.push(`## Previous Session Summary\n${checkpoint.summary}`);
        if (checkpoint.sections.decisions.length) parts.push(`## Decisions\n${checkpoint.sections.decisions.map(d => `- ${d}`).join('\n')}`);
        if (checkpoint.sections.openIssues.length) parts.push(`## Open Issues\n${checkpoint.sections.openIssues.map(i => `- ${i}`).join('\n')}`);
        checkpointContent = parts.join('\n\n');
        taskProgress = checkpoint.sections.taskProgress;
      }
    }

    let adapter;
    const rawChain =
      config.provider.fallbackChain && config.provider.fallbackChain.length > 0
        ? config.provider.fallbackChain
        : DEFAULT_ZERO_COST_CHAIN;
    // apiKeyRef (env:/literal) resolves to the concrete key the factory expects.
    const fallbackChain = (await Promise.all(
      (rawChain as import("@signhify/providers").EndpointConfig[]).map(async (ep) => {
        const key = await resolveApiKeyRef(ep.apiKeyRef);
        return "apiKeyRef" in ep && key != null ? { ...ep, apiKey: key } : ep;
      }),
    )) as import("@signhify/providers").EndpointConfig[];

    if (process.env.SIGNHIFY_MOCK_PROVIDER === "1" || config.provider.agent.vendor === "mock") {
      adapter = await createAdapter({ vendor: "mock", model: "mock-model" });
    } else {
      adapter = new FallbackRouter({
        endpoints: fallbackChain as import("@signhify/providers").EndpointConfig[],
        onFallback: (event: FallbackEvent) => {
          // stdout carries JSON only; diagnostics go to stderr.
          console.error(`[Fallback] ${event.fromEndpoint} -> ${event.toEndpoint} (${event.reason})`);
        },
      });
    }

    // Subagents get whatever adapter this run routes through; the planner
    // also persists its task tree through the same SQLite store.
    configureSubagents({
      adapter,
      model: config.provider.agent.model,
      memory: memoryStore,
      onProgress: (event) => console.error(`[subagent] ${event.message}`),
    });
    configureMcpServers(config.mcpServers ?? []);

    const loop = new AgentLoop({
      config,
      workingDirectory: cwd,
      provider: adapter,
      sessionId,
      autoMode: options.auto,
      projectInstructions,
      memoryContent: memContent || undefined,
      checkpointContent: checkpointContent || undefined,
      taskProgress: taskProgress || undefined,
      onStream: (chunk) => {
        if (chunk.type === 'done' && chunk.usage) {
          usageTokens = (chunk.usage.promptTokens ?? 0) + (chunk.usage.completionTokens ?? 0);
        }
        options.onStream?.(chunk);
      },
      onToolCall: options.onToolCall,
      onToolResult: options.onToolResult,
      confirm: options.confirm,
      onCheckpoint: (sessionId, usage) => {
        if (options.output === 'json') {
          console.error(`[checkpoint] ${sessionId} @ ${usage} tokens`);
        }
      },
    });

    // Report MCP connection status (stderr: stdout is reserved for the JSON result).
    if (config.mcpServers && config.mcpServers.length > 0) {
      console.error('MCP Servers:');
      for (const server of config.mcpServers) {
        console.error(`  - ${server.name}: configured; starts only after explicit approval`);
      }
    }

    // Register tools
    loop.registerTool(fileIoTool);
    loop.registerTool(shellExecTool);
    loop.registerTool(gitTool);
    loop.registerTool(searchTool);
    loop.registerTool(browserTool);
    loop.registerTool(mcpClientTool);
    loop.registerTool(subagentTool);

    // Set mode
    loop.getModeManager().setMode(options.mode as 'build' | 'plan' | 'debug' | 'compose');

    const result = await loop.run(task, options.signal);
    const elapsed = Date.now() - startTime;

    // End-of-run checkpoint so the session registry actually has something to
    // resume from (the checkpoints table was write-only until now).
    try {
      await checkpointWriter.writeCheckpoint({
        sessionId,
        summary: result.success
          ? `Completed "${task}" with ${result.toolCalls.length} tool call(s).`
          : `Failed "${task}": ${result.error ?? 'unknown'}`,
        tokenUsage: usageTokens,
        decisions: [],
        currentDiffs: [],
        openIssues: result.error ? [result.error.slice(0, 200)] : [],
      });
    } catch (err) {
      console.error(`[checkpoint] write failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const goalNotMet = result.goalMet === false && result.error?.includes('Max iterations');
    const runResult: RunResult = {
      success: result.success,
      cancelled: result.cancelled,
      task,
      mode: options.mode,
      auto: options.auto,
      sessionId,
      toolCalls: result.toolCalls.length,
      messages: result.messages.length,
      answer: [...result.messages].reverse().find((message) => message.role === 'assistant')?.content,
      goalMet: result.goalMet,
      goalVerdict: result.goalVerdict,
      error: result.error,
      exitCode: goalNotMet ? 2 : result.success ? 0 : 1,
      elapsedMs: elapsed,
    };

    if (options.output === 'json') {
      console.log(JSON.stringify(runResult, null, 2));
    } else if (options.output === 'text') {
      if (result.success) {
        console.log(`Task completed successfully in ${(elapsed / 1000).toFixed(1)}s`);
        console.log(`Tool calls: ${result.toolCalls.length}`);
      } else {
        console.error(`Task failed: ${result.error ?? 'Unknown error'}`);
      }
    }

    return runResult;
  } catch (error) {
    const runResult: RunResult = {
      success: false,
      cancelled: options.signal?.aborted,
      task,
      mode: options.mode,
      auto: options.auto,
      toolCalls: 0,
      messages: 0,
      error: error instanceof Error ? error.message : String(error),
      exitCode: 1,
      elapsedMs: Date.now() - startTime,
    };

    if (options.output === 'json') {
      console.log(JSON.stringify(runResult, null, 2));
    } else {
      console.error(`Fatal error: ${runResult.error}`);
    }

    return runResult;
  } finally {
    try {
      await disconnectAllMcpServers();
    } catch (error) {
      console.error(`[MCP] disconnect failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      memoryStore?.close();
    } catch (error) {
      console.error(`[memory] close failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
