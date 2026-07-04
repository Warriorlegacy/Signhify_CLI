import { ModelProviderAdapter } from './adapter.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { GoogleGeminiAdapter } from './google-gemini-adapter.js';
import { OpenAICompatibleAdapter } from './openai-compatible-adapter.js';

export interface ProviderFactoryConfig {
  vendor: 'anthropic' | 'google' | 'openai' | 'openai-compatible';
  model: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
}

export function createAdapter(config: ProviderFactoryConfig): ModelProviderAdapter {
  const apiKey = config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined) ?? '';

  switch (config.vendor) {
    case 'anthropic':
      return new AnthropicAdapter(apiKey, config.baseUrl);
    case 'google':
      return new GoogleGeminiAdapter(apiKey, config.baseUrl);
    case 'openai':
      return new OpenAIAdapter(apiKey, config.baseUrl);
    case 'openai-compatible':
      return new OpenAICompatibleAdapter(apiKey, config.baseUrl ?? 'http://localhost:11434/v1');
    default:
      throw new Error(`Unknown vendor: ${config.vendor}`);
  }
}
