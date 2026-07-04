import { describe, it, expect } from 'vitest';
import { createAdapter, listSupportedVendors } from '../factory.js';

describe('createAdapter', () => {
  it('should create openai adapter', async () => {
    const adapter = await createAdapter({ vendor: 'openai', model: 'gpt-4', apiKey: 'test' });
    expect(adapter.vendor).toBe('openai');
    expect(adapter.supportsFunctionCalling).toBe(true);
  });

  it('should create anthropic adapter', async () => {
    const adapter = await createAdapter({ vendor: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'test' });
    expect(adapter.vendor).toBe('anthropic');
    expect(adapter.supportsFunctionCalling).toBe(true);
  });

  it('should create google adapter', async () => {
    const adapter = await createAdapter({ vendor: 'google', model: 'gemini-pro', apiKey: 'test' });
    expect(adapter.vendor).toBe('google');
  });

  it('should create openai-compatible adapter', async () => {
    const adapter = await createAdapter({ vendor: 'openai-compatible', model: 'llama3', apiKey: 'test', baseUrl: 'http://localhost:11434/v1' });
    expect(adapter.vendor).toBe('openai-compatible');
  });

  it('should create mistral adapter', async () => {
    const adapter = await createAdapter({ vendor: 'mistral', model: 'mistral-large', apiKey: 'test' });
    expect(adapter.vendor).toBe('mistral');
  });

  it('should create groq adapter', async () => {
    const adapter = await createAdapter({ vendor: 'groq', model: 'llama-3.1-70b', apiKey: 'test' });
    expect(adapter.vendor).toBe('groq');
  });

  it('should create xai adapter', async () => {
    const adapter = await createAdapter({ vendor: 'xai', model: 'grok-3', apiKey: 'test' });
    expect(adapter.vendor).toBe('xai');
  });

  it('should create deepinfra adapter', async () => {
    const adapter = await createAdapter({ vendor: 'deepinfra', model: 'deepseek', apiKey: 'test' });
    expect(adapter.vendor).toBe('deepinfra');
  });

  it('should create cohere adapter', async () => {
    const adapter = await createAdapter({ vendor: 'cohere', model: 'command-r', apiKey: 'test' });
    expect(adapter.vendor).toBe('cohere');
  });

  it('should create together adapter', async () => {
    const adapter = await createAdapter({ vendor: 'togetherai', model: 'llama-3.1-70b', apiKey: 'test' });
    expect(adapter.vendor).toBe('togetherai');
  });

  it('should list supported vendors', () => {
    const vendors = listSupportedVendors();
    expect(vendors).toContain('openai');
    expect(vendors).toContain('anthropic');
    expect(vendors).toContain('google');
    expect(vendors).toContain('mistral');
    expect(vendors).toContain('groq');
    expect(vendors.length).toBeGreaterThan(10);
  });

  it('should throw on unknown vendor', async () => {
    await expect(createAdapter({ vendor: 'unknown', model: 'x', apiKey: 'test' })).rejects.toThrow('Unknown vendor');
  });
});
