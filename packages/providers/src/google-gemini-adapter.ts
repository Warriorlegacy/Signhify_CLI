import { ModelProviderAdapter } from './adapter.js';
import { Message, StreamChunk, ToolDefinition } from './types.js';

export class GoogleGeminiAdapter implements ModelProviderAdapter {
  readonly id = 'google-gemini';
  readonly vendor = 'google';
  readonly supportsFunctionCalling = true;

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://generativelanguage.googleapis.com') {
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
    const contents = params.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: params.temperature,
        maxOutputTokens: params.maxTokens,
      },
    };

    if (params.tools.length > 0) {
      body.tools = [{
        functionDeclarations: params.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    const systemMsg = params.messages.find(m => m.role === 'system');
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const url = `${this.baseUrl}/v1beta/models/${params.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `Gemini API error ${response.status}: ${errorText}` };
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
              const candidate = parsed.candidates?.[0];
              if (candidate?.content?.parts) {
                for (const part of candidate.content.parts) {
                  if (part.text) {
                    yield { type: 'text', content: part.text };
                  }
                  if (part.functionCall) {
                    yield {
                      type: 'tool_call',
                      toolCall: {
                        id: `gemini-${Date.now()}`,
                        name: part.functionCall.name,
                        arguments: part.functionCall.args ?? {},
                      },
                    };
                  }
                }
              }
              if (parsed.usageMetadata) {
                yield {
                  type: 'done',
                  usage: {
                    promptTokens: parsed.usageMetadata.promptTokenCount ?? 0,
                    completionTokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
                    totalTokens: parsed.usageMetadata.totalTokenCount ?? 0,
                  },
                };
              }
            } catch {
              // Skip
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
