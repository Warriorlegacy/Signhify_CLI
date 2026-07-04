import { ModelProviderAdapter } from './adapter.js';
import { Message, StreamChunk, ToolDefinition } from './types.js';

export class AnthropicAdapter implements ModelProviderAdapter {
  readonly id = 'anthropic';
  readonly vendor = 'anthropic';
  readonly supportsFunctionCalling = true;

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com') {
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
    const systemMsg = params.messages.find(m => m.role === 'system');
    const otherMessages = params.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: otherMessages.map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.role === 'tool' ? [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] : m.content,
      })),
      stream: true,
    };

    if (systemMsg) body.system = systemMsg.content;
    if (params.temperature !== undefined) body.temperature = params.temperature;

    if (params.tools.length > 0) {
      body.tools = params.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `Anthropic API error ${response.status}: ${errorText}` };
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
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta') {
                if (parsed.delta?.type === 'text_delta') {
                  yield { type: 'text', content: parsed.delta.text };
                }
                if (parsed.delta?.type === 'input_json_delta') {
                  yield { type: 'text', content: '' };
                }
              }
              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: parsed.content_block.id,
                    name: parsed.content_block.name,
                    arguments: {},
                  },
                };
              }
              if (parsed.type === 'message_stop') {
                yield { type: 'done' };
                return;
              }
              if (parsed.type === 'message_delta' && parsed.usage) {
                yield {
                  type: 'done',
                  usage: {
                    promptTokens: parsed.usage.input_tokens ?? 0,
                    completionTokens: parsed.usage.output_tokens ?? 0,
                    totalTokens: (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0),
                  },
                };
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }
}
