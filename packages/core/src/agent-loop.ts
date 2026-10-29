import { Message, StreamChunk, ToolCall, Goal, GoalVerdict, SignhifyConfig, ToolDefinition } from './types.js';
import { ModeManager } from './modes.js';
import { PermissionEngine } from './permission-engine.js';
import { ContextManager, ContextAssemblyResult } from './context-manager.js';
import { TaskManager } from './task-manager.js';
import * as readline from 'node:readline';

export interface ModelProviderAdapter {
  readonly id: string;
  readonly vendor: string;
  readonly supportsFunctionCalling: boolean;

  streamChat(params: {
    messages: Message[];
    tools: ToolDefinition[];
    model: string;
    temperature?: number;
    maxTokens?: number;
    abortSignal?: AbortSignal;
  }): AsyncIterable<StreamChunk>;

  countTokens(text: string): number;
}

function extractGoalVerdict(text: string): GoalVerdict | null {
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed) as GoalVerdict;
    if (typeof parsed?.met === 'boolean') {
      return {
        met: parsed.met,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        remainingSteps: Array.isArray(parsed.remainingSteps) ? parsed.remainingSteps : [],
      };
    }
  } catch {
    // not a full JSON document — try substring extraction
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as GoalVerdict;
    if (typeof parsed?.met === 'boolean') {
      return {
        met: parsed.met,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        remainingSteps: Array.isArray(parsed.remainingSteps) ? parsed.remainingSteps : [],
      };
    }
  } catch {
    // malformed JSON
  }

  return null;
}

export interface ToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresConsent?: boolean | ((args: Record<string, unknown>) => boolean);
  preview?(args: Record<string, unknown>, context: { workingDirectory: string; projectDir?: string; autoMode?: boolean }): Promise<string>;
  execute(args: Record<string, unknown>, context: {
    workingDirectory: string;
    projectDir?: string;
    autoMode?: boolean;
    confirm?: (message: string) => Promise<boolean>;
    consentGranted?: boolean;
    approvedPreview?: string;
    signal?: AbortSignal;
    invokeTool?: (name: 'file-io' | 'shell-exec', args: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
  }): Promise<string>;
}

export interface AgentLoopOptions {
  config: SignhifyConfig;
  workingDirectory: string;
  provider?: ModelProviderAdapter;
  /** Override the generated session id so checkpoints link to the registry row. */
  sessionId?: string;
  goal?: Goal;
  autoMode?: boolean;
  projectInstructions?: string;
  memoryContent?: string;
  checkpointContent?: string;
  taskProgress?: string;
  onStream?: (chunk: StreamChunk) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (toolCallId: string, result: string, isError?: boolean) => void;
  onCheckpoint?: (sessionId: string, usage: number) => void;
  confirm?: (message: string) => Promise<boolean>;
  selfVerifyCommand?: string;
}

export interface AgentLoopResult {
  success: boolean;
  cancelled?: boolean;
  messages: Message[];
  toolCalls: Array<{ call: ToolCall; result: string; isError?: boolean }>;
  goalMet?: boolean;
  goalVerdict?: GoalVerdict;
  error?: string;
}

export class AgentLoop {
  readonly sessionId: string;
  private config: SignhifyConfig;
  private workingDirectory: string;
  private messages: Message[] = [];
  private modeManager: ModeManager;
  private permissionEngine: PermissionEngine;
  private contextManager: ContextManager;
  private taskManager: TaskManager;
  private toolHandlers: Map<string, ToolHandler> = new Map();
  private provider?: ModelProviderAdapter;
  private goal?: Goal;
  private autoMode: boolean;
  private maxIterations = 20;
  private selfVerifyCommand?: string;
  private projectInstructions?: string;
  private memoryContent?: string;
  private checkpointContent?: string;
  private taskProgress?: string;
  private onStream?: (chunk: StreamChunk) => void;
  private onToolCall?: (call: ToolCall) => void;
  private onToolResult?: (toolCallId: string, result: string, isError?: boolean) => void;
  private onCheckpoint?: (sessionId: string, usage: number) => void;
  private confirm?: (message: string) => Promise<boolean>;
  private toolCallHistory: Array<{ call: ToolCall; result: string; isError?: boolean }> = [];
  private filesWrittenSinceLastVerify: string[] = [];

  constructor(options: AgentLoopOptions) {
    this.sessionId = options.sessionId ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.config = options.config;
    this.workingDirectory = options.workingDirectory;
    this.provider = options.provider;
    this.goal = options.goal;
    this.autoMode = options.autoMode ?? false;
    this.selfVerifyCommand = options.selfVerifyCommand;
    this.projectInstructions = options.projectInstructions;
    this.memoryContent = options.memoryContent;
    this.checkpointContent = options.checkpointContent;
    this.taskProgress = options.taskProgress;
    this.onStream = options.onStream;
    this.onToolCall = options.onToolCall;
    this.onToolResult = options.onToolResult;
    this.onCheckpoint = options.onCheckpoint;
    this.confirm = options.confirm;

    this.modeManager = new ModeManager(options.config.modes?.custom);
    this.permissionEngine = new PermissionEngine(
      this.modeManager,
      options.config.automation,
      this.autoMode
    );
    this.contextManager = new ContextManager(options.config.memory);
    this.taskManager = new TaskManager(this.workingDirectory);
  }

  registerTool(handler: ToolHandler): void {
    this.toolHandlers.set(handler.name, handler);
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.toolHandlers.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  getModeManager(): ModeManager {
    return this.modeManager;
  }

  getPermissionEngine(): PermissionEngine {
    return this.permissionEngine;
  }

  getTaskManager(): TaskManager {
    return this.taskManager;
  }

  getContextManager(): ContextManager {
    return this.contextManager;
  }

  async run(initialMessage: string, signal?: AbortSignal): Promise<AgentLoopResult> {
    if (signal?.aborted) {
      return { success: false, cancelled: true, messages: this.messages, toolCalls: this.toolCallHistory, error: 'Run cancelled by user' };
    }
    this.messages.push({ role: 'user', content: initialMessage, timestamp: Date.now() });

    // Auto-create a root task for this run
    const rootTaskId = await this.taskManager.createTask(initialMessage.slice(0, 80));
    await this.taskManager.startTask(rootTaskId);

    let iterations = 0;

    while (iterations < this.maxIterations && !signal?.aborted) {
      iterations++;

      const context = this.contextManager.assembleContext({
        systemPrompt: this.modeManager.getCurrentMode().prompt,
        projectInstructions: this.projectInstructions,
        memoryContent: this.memoryContent,
        checkpointContent: this.checkpointContent,
        taskProgress: this.taskProgress,
        recentMessages: this.messages,
      });

      let response: StreamChunk;
      try {
        response = await this.callProvider(context, signal);
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return this.cancelledResult(rootTaskId);
        return {
          success: false,
          messages: this.messages,
          toolCalls: this.toolCallHistory,
          error: `Provider error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (signal?.aborted) return this.cancelledResult(rootTaskId);

      if (response.type === 'error') {
        if (signal?.aborted) return this.cancelledResult(rootTaskId);
        return {
          success: false,
          messages: this.messages,
          toolCalls: this.toolCallHistory,
          error: response.error ?? 'Unknown provider error',
        };
      }

      if (response.type === 'text') {
        this.messages.push({ role: 'assistant', content: response.content ?? '', timestamp: Date.now() });

        if (this.goal) {
          const verdict = await this.checkGoal(signal);
          if (signal?.aborted) return this.cancelledResult(rootTaskId);
          await this.taskManager.completeTask(rootTaskId);
          return {
            success: verdict?.met ?? false,
            messages: this.messages,
            toolCalls: this.toolCallHistory,
            goalMet: verdict?.met,
            goalVerdict: verdict ?? undefined,
          };
        }

        await this.taskManager.completeTask(rootTaskId);
        return {
          success: true,
          messages: this.messages,
          toolCalls: this.toolCallHistory,
        };
      }

      if (response.type === 'tool_call' && response.toolCall) {
        const result = await this.executeToolCall(response.toolCall, signal);
        this.toolCallHistory.push({ call: response.toolCall, result: result.content, isError: result.isError });
        this.onToolResult?.(response.toolCall.id, result.content, result.isError);
        this.messages.push({
          role: 'assistant',
          content: '',
          toolCalls: [response.toolCall],
          timestamp: Date.now(),
        });
        this.messages.push({
          role: 'tool',
          content: result.content,
          toolCallId: response.toolCall.id,
          timestamp: Date.now(),
        });

        if (signal?.aborted) return this.cancelledResult(rootTaskId);

        // Self-verify after tool execution if files were changed
        if (this.filesWrittenSinceLastVerify.length > 0 && this.selfVerifyCommand) {
          const verifyResult = await this.runSelfVerify(signal);
          if (verifyResult.isError) {
            // Let the model see the verification failure and loop back
            this.messages.push({
              role: 'tool',
              content: `[Self-verify failed]\n${verifyResult.content}`,
              toolCallId: `self-verify-${Date.now()}`,
              timestamp: Date.now(),
            });
          }
          this.filesWrittenSinceLastVerify = [];
        }
      }

      if (response.type === 'done') {
        const usage = response.usage?.totalTokens ?? 0;
        if (this.contextManager.shouldCheckpoint(usage, 128000)) {
          this.onCheckpoint?.(this.sessionId, usage);
        }
      }
    }

    if (signal?.aborted) return this.cancelledResult(rootTaskId);
    await this.taskManager.blockTask(rootTaskId, 'Max iterations reached');
    return {
      success: false,
      messages: this.messages,
      toolCalls: this.toolCallHistory,
      error: `Max iterations (${this.maxIterations}) reached`,
    };
  }

  private async cancelledResult(rootTaskId: string): Promise<AgentLoopResult> {
    await this.taskManager.blockTask(rootTaskId, 'Run cancelled by user');
    return { success: false, cancelled: true, messages: this.messages, toolCalls: this.toolCallHistory, error: 'Run cancelled by user' };
  }

  private async callProvider(context: ContextAssemblyResult, signal?: AbortSignal): Promise<StreamChunk> {
    if (!this.provider) {
      return { type: 'text', content: 'No provider configured. Set a provider in config.' };
    }

    const tools = this.getToolDefinitions();
    const stream = this.provider.streamChat({
      messages: context.messages,
      tools,
      model: this.config.provider.agent.model,
      abortSignal: signal,
    });

    let accumulatedText = '';
    let currentToolCall: ToolCall | null = null;
    const toolCallChunks: Record<string, string> = {};

    for await (const chunk of stream) {
      if (signal?.aborted) throw new Error('Run cancelled by user');
      this.onStream?.(chunk);

      if (chunk.type === 'text' && chunk.content) {
        accumulatedText += chunk.content;
      }

      if (chunk.type === 'tool_call' && chunk.toolCall) {
        if (currentToolCall && currentToolCall.id !== chunk.toolCall.id) {
          // Flush previous tool call
          this.onToolCall?.(currentToolCall);
        }
        if (!currentToolCall || currentToolCall.id !== chunk.toolCall.id) {
          currentToolCall = { ...chunk.toolCall };
          toolCallChunks[currentToolCall.id] = '';
        }
        if (chunk.toolCall.arguments && Object.keys(chunk.toolCall.arguments).length > 0) {
          toolCallChunks[currentToolCall.id] = JSON.stringify(chunk.toolCall.arguments);
        }
        this.onToolCall?.(chunk.toolCall);
      }

      if (chunk.type === 'done') {
        if (currentToolCall) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCallChunks[currentToolCall.id] || '{}');
          } catch {
            // leave as empty object
          }
          return { type: 'tool_call', toolCall: { ...currentToolCall, arguments: args } };
        }
        if (accumulatedText) {
          return { type: 'text', content: accumulatedText };
        }
        return { type: 'text', content: '' };
      }

      if (chunk.type === 'error') {
        return { type: 'error', error: chunk.error };
      }
    }

    if (signal?.aborted) throw new Error('Run cancelled by user');

    if (currentToolCall) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCallChunks[currentToolCall.id] || '{}');
      } catch {
        // leave as empty object
      }
      return { type: 'tool_call', toolCall: { ...currentToolCall, arguments: args } };
    }

    return { type: 'text', content: accumulatedText };
  }

  private async executeToolCall(call: ToolCall, signal?: AbortSignal): Promise<{ content: string; isError?: boolean }> {
    if (signal?.aborted) return { content: 'Run cancelled by user', isError: true };
    const permission = this.permissionEngine.canUseTool(call.name);
    if (!permission.allowed) {
      return { content: `Permission denied: ${permission.reason}`, isError: true };
    }

    const handler = this.toolHandlers.get(call.name);
    if (!handler) {
      return { content: `Unknown tool: ${call.name}`, isError: true };
    }

    let consentGranted = false;
    let approvedPreview: string | undefined;
    // Read-only tool actions can share a handler with actions that need approval.
    const requiresConsent = typeof handler.requiresConsent === 'function'
      ? handler.requiresConsent(call.arguments)
      : handler.requiresConsent;
    if (requiresConsent && !this.autoMode) {
      let preview = '';
      if (handler.preview) {
        try {
          preview = `\n${await handler.preview(call.arguments, {
            workingDirectory: this.workingDirectory,
            projectDir: this.workingDirectory,
            autoMode: this.autoMode,
          })}`;
        } catch (error) {
          return { content: `Tool action denied: ${error instanceof Error ? error.message : String(error)}`, isError: true };
        }
      }
      const confirmed = await this.promptConfirmation(`Execute ${call.name}${preview}`, signal);
      if (!confirmed) {
        return { content: `${call.name} denied by user consent`, isError: true };
      }
      consentGranted = true;
    }

    if (call.name === 'shell-exec') {
      const cmd = (call.arguments.command as string) ?? '';
      const shellPerm = this.permissionEngine.canExecuteShell(cmd);
      if (!shellPerm.allowed) {
        return { content: `Permission denied: ${shellPerm.reason}`, isError: true };
      }
      if (shellPerm.requiresConfirmation && !this.autoMode) {
        const confirmed = await this.promptConfirmation(`Execute shell command: ${cmd}`, signal);
        if (!confirmed) {
          return { content: 'Shell command denied by user', isError: true };
        }
      }
    }

    if (call.name === 'file-io') {
      const action = (call.arguments.action as string) ?? '';
      const filePerm = this.permissionEngine.canPerformFileAction(call.name, action);
      if (!filePerm.allowed) {
        return { content: `Permission denied: ${filePerm.reason}`, isError: true };
      }
      if (action === 'write') {
        if (!this.autoMode) {
          if (!handler.preview) {
            return { content: 'File write denied: this tool cannot provide a review preview', isError: true };
          }
          let preview: string;
          try {
            preview = await handler.preview(call.arguments, {
              workingDirectory: this.workingDirectory,
              projectDir: this.workingDirectory,
              autoMode: this.autoMode,
            });
          } catch (error) {
            return { content: `File write denied: ${error instanceof Error ? error.message : String(error)}`, isError: true };
          }
          const confirmed = await this.promptConfirmation(`${preview}\n\nApply this file write?`, signal);
          if (!confirmed) return { content: 'File write denied by user', isError: true };
          consentGranted = true;
          approvedPreview = preview;
        }
        this.filesWrittenSinceLastVerify.push((call.arguments.path as string) ?? '');
      }
    }

    try {
      const result = await handler.execute(call.arguments, {
        workingDirectory: this.workingDirectory,
        projectDir: this.workingDirectory,
        autoMode: this.autoMode,
        confirm: this.confirm,
        consentGranted,
        approvedPreview,
        signal,
        invokeTool: async (name, args) => {
          const nestedCall: ToolCall = {
            id: `${call.id}:${name}:${this.toolCallHistory.length}`,
            name,
            arguments: args,
          };
          this.onToolCall?.(nestedCall);
          const nestedResult = await this.executeToolCall(nestedCall, signal);
          this.toolCallHistory.push({ call: nestedCall, result: nestedResult.content, isError: nestedResult.isError });
          this.onToolResult?.(nestedCall.id, nestedResult.content, nestedResult.isError);
          return nestedResult;
        },
      });
      return { content: result };
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { content: 'Run cancelled by user', isError: true };
      }
      return { content: `Tool error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  }

  private async runSelfVerify(signal?: AbortSignal): Promise<{ content: string; isError?: boolean }> {
    const tool = this.toolHandlers.get('shell-exec');
    if (!tool) return { content: 'No shell-exec tool registered for self-verify', isError: true };

    try {
      const result = await tool.execute(
        { command: this.selfVerifyCommand!, timeoutMs: 120000 },
        { workingDirectory: this.workingDirectory, projectDir: this.workingDirectory, autoMode: this.autoMode, signal }
      );
      return { content: result };
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { content: 'Run cancelled by user', isError: true };
      }
      return { content: `Self-verify error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  }

  async checkGoal(signal?: AbortSignal): Promise<GoalVerdict | null> {
    if (!this.goal || !this.provider) return null;

    const transcript = this.messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    try {
      const stream = this.provider.streamChat({
        messages: [
          {
            role: 'system',
            content:
              'You are a goal judge. Given a goal statement and a task transcript, respond with ONLY a JSON object: { "met": boolean, "reason": string, "remainingSteps": string[] }. No markdown fences, no preamble.',
          },
          {
            role: 'user',
            content: `Goal: ${this.goal.statement}\n\nTranscript:\n${transcript}`,
          },
        ],
        tools: [],
        model: this.config.provider.agent.model,
        abortSignal: signal,
      });

      let verdictText = '';
      for await (const chunk of stream) {
        if (chunk.type === 'text' && chunk.content) {
          verdictText += chunk.content;
        }
      }

      const verdict = extractGoalVerdict(verdictText);
      if (verdict) return verdict;

      return {
        met: false,
        reason: 'Judge returned non-JSON response',
        remainingSteps: ['Re-run with clearer goal'],
      };
    } catch {
      return {
        met: false,
        reason: 'Goal judge call failed',
        remainingSteps: ['Retry or manually verify'],
      };
    }
  }

  setGoal(goal: Goal): void {
    this.goal = goal;
  }

  private async promptConfirmation(message: string, signal?: AbortSignal): Promise<boolean> {
    if (this.autoMode) return true;
    if (signal?.aborted) return false;

    if (this.confirm) {
      return new Promise((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const onAbort = () => {
          cleanup();
          resolve(false);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        this.confirm!(message).then(
          (approved) => {
            cleanup();
            resolve(approved);
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
      });
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
      const finish = (approved: boolean) => {
        signal?.removeEventListener('abort', onAbort);
        rl.close();
        resolve(approved);
      };
      const onAbort = () => finish(false);
      signal?.addEventListener('abort', onAbort, { once: true });
      rl.question(`\n${message}\nAllow? (y/N) `, (answer) => {
        finish(answer.trim().toLowerCase() === 'y');
      });
    });
  }
}
