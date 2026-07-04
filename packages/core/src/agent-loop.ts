import { Message, StreamChunk, ToolCall, Goal, GoalVerdict, SignhifyConfig, ToolDefinition } from './types.js';
import { ModeManager } from './modes.js';
import { PermissionEngine, PermissionCheck } from './permission-engine.js';
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
  requiresConsent?: boolean;
  execute(args: Record<string, unknown>, context: { workingDirectory: string; projectDir?: string; autoMode?: boolean }): Promise<string>;
}

export interface AgentLoopOptions {
  config: SignhifyConfig;
  workingDirectory: string;
  provider?: ModelProviderAdapter;
  goal?: Goal;
  autoMode?: boolean;
  memoryContent?: string;
  checkpointContent?: string;
  taskProgress?: string;
  onStream?: (chunk: StreamChunk) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (toolCallId: string, result: string, isError?: boolean) => void;
  onCheckpoint?: (sessionId: string, usage: number) => void;
  selfVerifyCommand?: string;
}

export interface AgentLoopResult {
  success: boolean;
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
  private memoryContent?: string;
  private checkpointContent?: string;
  private taskProgress?: string;
  private onStream?: (chunk: StreamChunk) => void;
  private onToolCall?: (call: ToolCall) => void;
  private onToolResult?: (toolCallId: string, result: string, isError?: boolean) => void;
  private onCheckpoint?: (sessionId: string, usage: number) => void;
  private toolCallHistory: Array<{ call: ToolCall; result: string; isError?: boolean }> = [];
  private filesWrittenSinceLastVerify: string[] = [];

  constructor(options: AgentLoopOptions) {
    this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.config = options.config;
    this.workingDirectory = options.workingDirectory;
    this.provider = options.provider;
    this.goal = options.goal;
    this.autoMode = options.autoMode ?? false;
    this.selfVerifyCommand = options.selfVerifyCommand;
    this.memoryContent = options.memoryContent;
    this.checkpointContent = options.checkpointContent;
    this.taskProgress = options.taskProgress;
    this.onStream = options.onStream;
    this.onToolCall = options.onToolCall;
    this.onToolResult = options.onToolResult;
    this.onCheckpoint = options.onCheckpoint;

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

  async run(initialMessage: string): Promise<AgentLoopResult> {
    this.messages.push({ role: 'user', content: initialMessage, timestamp: Date.now() });

    // Auto-create a root task for this run
    const rootTaskId = await this.taskManager.createTask(initialMessage.slice(0, 80));
    await this.taskManager.startTask(rootTaskId);

    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      const context = this.contextManager.assembleContext({
        systemPrompt: this.modeManager.getCurrentMode().prompt,
        memoryContent: this.memoryContent,
        checkpointContent: this.checkpointContent,
        taskProgress: this.taskProgress,
        recentMessages: this.messages,
      });

      let response: StreamChunk;
      try {
        response = await this.callProvider(context);
      } catch (error) {
        return {
          success: false,
          messages: this.messages,
          toolCalls: this.toolCallHistory,
          error: `Provider error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (response.type === 'error') {
        return {
          success: false,
          messages: this.messages,
          toolCalls: this.toolCallHistory,
          error: response.error ?? 'Unknown provider error',
        };
      }

      if (response.type === 'text') {
        this.messages.push({ role: 'assistant', content: response.content ?? '', timestamp: Date.now() });
        await this.taskManager.completeTask(rootTaskId);

        if (this.goal) {
          const verdict = await this.checkGoal();
          return {
            success: verdict?.met ?? false,
            messages: this.messages,
            toolCalls: this.toolCallHistory,
            goalMet: verdict?.met,
            goalVerdict: verdict ?? undefined,
          };
        }

        return {
          success: true,
          messages: this.messages,
          toolCalls: this.toolCallHistory,
        };
      }

      if (response.type === 'tool_call' && response.toolCall) {
        const result = await this.executeToolCall(response.toolCall);
        this.toolCallHistory.push({ call: response.toolCall, result: result.content, isError: result.isError });
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

        // Self-verify after tool execution if files were changed
        if (this.filesWrittenSinceLastVerify.length > 0 && this.selfVerifyCommand) {
          const verifyResult = await this.runSelfVerify();
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

    await this.taskManager.blockTask(rootTaskId, 'Max iterations reached');
    return {
      success: false,
      messages: this.messages,
      toolCalls: this.toolCallHistory,
      error: `Max iterations (${this.maxIterations}) reached`,
    };
  }

  private async callProvider(context: ContextAssemblyResult): Promise<StreamChunk> {
    if (!this.provider) {
      return { type: 'text', content: 'No provider configured. Set a provider in config.' };
    }

    const tools = this.getToolDefinitions();
    const stream = this.provider.streamChat({
      messages: context.messages,
      tools,
      model: this.config.provider.agent.model,
    });

    let accumulatedText = '';
    let currentToolCall: ToolCall | null = null;
    const toolCallChunks: Record<string, string> = {};

    for await (const chunk of stream) {
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

  private async executeToolCall(call: ToolCall): Promise<{ content: string; isError?: boolean }> {
    const permission = this.permissionEngine.canUseTool(call.name);
    if (!permission.allowed) {
      return { content: `Permission denied: ${permission.reason}`, isError: true };
    }

    if (call.name === 'shell-exec') {
      const cmd = (call.arguments.command as string) ?? '';
      const shellPerm = this.permissionEngine.canExecuteShell(cmd);
      if (!shellPerm.allowed) {
        return { content: `Permission denied: ${shellPerm.reason}`, isError: true };
      }
      if (shellPerm.requiresConfirmation && !this.autoMode) {
        const confirmed = await this.promptConfirmation(`Execute shell command: ${cmd}`);
        if (!confirmed) {
          return { content: 'Shell command denied by user', isError: true };
        }
      }
    }

    if (call.name === 'file-write') {
      const filePerm = this.permissionEngine.canWriteFile((call.arguments.path as string) ?? '');
      if (!filePerm.allowed) {
        return { content: `Permission denied: ${filePerm.reason}`, isError: true };
      }
      this.filesWrittenSinceLastVerify.push((call.arguments.path as string) ?? '');
    }

    const handler = this.toolHandlers.get(call.name);
    if (!handler) {
      return { content: `Unknown tool: ${call.name}`, isError: true };
    }

    try {
      const result = await handler.execute(call.arguments, {
        workingDirectory: this.workingDirectory,
        projectDir: this.workingDirectory,
        autoMode: this.autoMode,
      });
      return { content: result };
    } catch (error) {
      return { content: `Tool error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  }

  private async runSelfVerify(): Promise<{ content: string; isError?: boolean }> {
    const tool = this.toolHandlers.get('shell-exec');
    if (!tool) return { content: 'No shell-exec tool registered for self-verify', isError: true };

    try {
      const result = await tool.execute(
        { command: this.selfVerifyCommand!, timeoutMs: 120000 },
        { workingDirectory: this.workingDirectory, projectDir: this.workingDirectory, autoMode: this.autoMode }
      );
      return { content: result };
    } catch (error) {
      return { content: `Self-verify error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  }

  async checkGoal(): Promise<GoalVerdict | null> {
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

  private async promptConfirmation(message: string): Promise<boolean> {
    if (this.autoMode) return true;

    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
      rl.question(`\n${message}\nAllow? (y/N) `, (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });
  }
}
