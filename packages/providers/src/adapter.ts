import { streamText } from 'ai';
import type { LanguageModel, TextStreamPart, LanguageModelCallOptions, ModelMessage } from 'ai';

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  error?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

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

function toAIStreamEvent(event: TextStreamPart<Record<string, never>>): StreamChunk | null {
  switch (event.type) {
    case 'text-delta':
      return { type: 'text', content: event.text };
    case 'tool-call':
      return {
        type: 'tool_call',
        toolCall: {
          id: event.toolCallId,
          name: event.toolName,
          arguments: event.input as Record<string, unknown>,
        },
      };
    case 'error':
      return { type: 'error', error: event.error instanceof Error ? event.error.message : String(event.error) };
    case 'finish':
      return {
        type: 'done',
        usage: {
          promptTokens: event.totalUsage.inputTokens ?? 0,
          completionTokens: event.totalUsage.outputTokens ?? 0,
        },
      };
    default:
      return null;
  }
}

export function createAISDKAdapter(config: {
  vendor: string;
  getModel: (modelId: string) => LanguageModel;
}): ModelProviderAdapter {
  async function* streamChat(params: {
    messages: Message[];
    tools: ToolDefinition[];
    model: string;
    temperature?: number;
    maxTokens?: number;
  }): AsyncIterable<StreamChunk> {
    try {
      const model = config.getModel(params.model);
      const callOptions: LanguageModelCallOptions = {};
      if (params.temperature !== undefined) callOptions.temperature = params.temperature;
      if (params.maxTokens !== undefined) callOptions.maxOutputTokens = params.maxTokens;

      const systemParts = params.messages.filter(m => m.role === 'system');
      const system = systemParts.length > 0 ? systemParts.map(m => m.content).join('\n\n') : undefined;
      const nonSystemMessages = params.messages.filter(m => m.role !== 'system') as ModelMessage[];

      const result = streamText({
        model,
        system,
        messages: nonSystemMessages,
        ...callOptions,
      });

      for await (const event of result.fullStream) {
        const chunk = toAIStreamEvent(event as TextStreamPart<Record<string, never>>);
        if (chunk) yield chunk;
      }
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    id: config.vendor,
    vendor: config.vendor,
    supportsFunctionCalling: true,
    streamChat,
    countTokens: (text: string) => Math.ceil(text.length / 4),
  };
}
