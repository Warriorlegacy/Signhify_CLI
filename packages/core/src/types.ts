// Message types
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// Stream types
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  error?: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
}

// Config types
export interface SignhifyConfig {
  provider: {
    agent: ProviderConfig;
    autocomplete?: ProviderConfig;
    fallbackChain?: FallbackEndpointConfig[];
  };
  modes?: {
    custom?: CustomMode[];
  };
  memory?: MemoryConfig;
  automation?: AutomationConfig;
  mcpServers?: McpServerConfig[];
}

export interface ProviderConfig {
  vendor: string;
  model: string;
  apiKey?: string;
  apiKeyRef?: string;
  baseUrl?: string;
}

export interface FallbackEndpointConfig extends ProviderConfig {
  name: string;
  isLocal?: boolean;
}

export interface CustomMode {
  name: string;
  prompt: string;
  allowedTools: string[];
}

export interface MemoryConfig {
  tokenBudget?: number;
  checkpointThresholdPct?: number;
  contextLimit?: number;
  /**
   * Kilo-style threshold_percent: compaction engages only once the estimated
   * context crosses this share of the context limit (0 = legacy
   * window-first semantics). Passed straight to ContextManager.
   */
  thresholdPercent?: number;
}

export interface AutomationConfig {
  shellAllowlist?: string[];
  shellDenylist?: string[];
}

export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  transport?: 'stdio';
}

// Goal/stop condition
export interface Goal {
  statement: string;
  maxIterations?: number;
}

export interface GoalVerdict {
  met: boolean;
  reason: string;
  remainingSteps: string[];
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
