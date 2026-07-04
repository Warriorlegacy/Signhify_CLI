import { ModelProviderAdapter } from './adapter.js';
import { Message, StreamChunk, ToolDefinition } from './types.js';

export class OpenAIAdapter implements ModelProviderAdapter {
  readonly id = 'openai';
  readonly vendor = 'openai';
  readonly supportsFunctionCalling = true;

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async *streamChat(params: {
    messages: Message[];
    tools: ToolDefinition[];
    model: string;
    temperature?: number;
    maxTokens?: number;
  }): AsyncIterable<StreamChunk> {
    const body = {
      model: params.model,
      messages: params.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls && { tool_calls: m.toolCalls }),
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
      })),
      tools: params.tools.length > 0 ? params.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })) : undefined,
      stream: true,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `OpenAI API error ${response.status}: ${errorText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              yield { type: 'done' };
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                yield { type: 'text', content: delta.content };
              }
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: tc.id ?? '',
                      name: tc.function?.name ?? '',
                      arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
                    },
                  };
                }
              }
              if (parsed.usage) {
                yield {
                  type: 'done',
                  usage: {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  },
                };
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
