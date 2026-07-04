export interface ModelProviderAdapter {
  readonly id: string;
  readonly vendor: string;
  readonly supportsFunctionCalling: boolean;

  streamChat(params: {
    messages: {
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      toolCallId?: string;
    }[];
    tools: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }[];
    model: string;
    temperature?: number;
    maxTokens?: number;
  }): AsyncIterable<{
    type: 'text' | 'tool_call' | 'done' | 'error';
    content?: string;
    toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
    error?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }>;

  countTokens(text: string): number;
}
