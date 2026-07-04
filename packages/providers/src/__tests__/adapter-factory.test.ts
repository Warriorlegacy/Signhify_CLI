import { describe, it, expect } from 'vitest';
import { createAdapter } from '../factory.js';
import { OpenAIAdapter } from '../openai-adapter.js';
import { AnthropicAdapter } from '../anthropic-adapter.js';
import { GoogleGeminiAdapter } from '../google-gemini-adapter.js';
import { OpenAICompatibleAdapter } from '../openai-compatible-adapter.js';

describe('createAdapter', () => {
  it('should create OpenAI adapter', () => {
    const adapter = createAdapter({ vendor: 'openai', model: 'gpt-4', apiKey: 'test' });
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
  });

  it('should create Anthropic adapter', () => {
    const adapter = createAdapter({ vendor: 'anthropic', model: 'claude-3-opus', apiKey: 'test' });
    expect(adapter).toBeInstanceOf(AnthropicAdapter);
  });

  it('should create Google adapter', () => {
    const adapter = createAdapter({ vendor: 'google', model: 'gemini-pro', apiKey: 'test' });
    expect(adapter).toBeInstanceOf(GoogleGeminiAdapter);
  });

  it('should create compatible adapter', () => {
    const adapter = createAdapter({ vendor: 'openai-compatible', model: 'llama3', apiKey: 'test', baseUrl: 'http://localhost:11434/v1' });
    expect(adapter).toBeInstanceOf(OpenAICompatibleAdapter);
  });

  it('should throw on unknown vendor', () => {
    expect(() => createAdapter({ vendor: 'unknown' as 'openai', model: 'x', apiKey: 'test' })).toThrow('Unknown vendor');
  });
});
