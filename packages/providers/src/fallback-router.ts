import { createAdapter, ProviderFactoryConfig } from './factory.js';
import { ModelProviderAdapter, StreamChunk, Message, ToolDefinition } from './adapter.js';

export interface EndpointConfig extends ProviderFactoryConfig {
  name: string;
  isLocal?: boolean;
}

export interface FallbackEvent {
  fromEndpoint: string;
  toEndpoint: string;
  reason: string;
  timestamp: string;
}

export interface FallbackRouterOptions {
  endpoints: EndpointConfig[];
  onFallback?: (event: FallbackEvent) => void;
  onEndpointSuccess?: (endpointName: string) => void;
  healthTimeoutMs?: number;
  circuitBreakerCooldownMs?: number;
}

interface CircuitBreakerStatus {
  failedUntil: number;
  failureReason?: string;
}

export const DEFAULT_ZERO_COST_CHAIN: EndpointConfig[] = [
  {
    name: '9router-local',
    vendor: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:20128/v1',
    model: 'gemini-2.0-flash',
    apiKey: '9router-local',
    isLocal: true,
  },
  {
    name: 'freellmapi-local',
    vendor: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:31415/v1',
    model: 'default',
    apiKey: 'freellmapi-local',
    isLocal: true,
  },
  {
    name: 'antseed-local',
    vendor: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:18888/v1',
    model: 'default',
    apiKey: 'antseed-local',
    isLocal: true,
  },
  {
    name: 'google-gemini-free',
    vendor: 'google',
    model: 'gemini-2.0-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  {
    name: 'groq-cloud',
    vendor: 'groq',
    model: 'llama-3.3-70b-versatile',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  {
    name: 'openrouter-free',
    vendor: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  {
    name: 'nvidia-nim',
    vendor: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'deepseek-ai/deepseek-r1',
    apiKeyEnv: 'NVIDIA_API_KEY',
  },
];

export class FallbackRouter implements ModelProviderAdapter {
  readonly id = 'fallback-router';
  readonly vendor = 'fallback-router';
  readonly supportsFunctionCalling = true;

  private endpoints: EndpointConfig[];
  private onFallback?: (event: FallbackEvent) => void;
  private onEndpointSuccess?: (endpointName: string) => void;
  private healthTimeoutMs: number;
  private cooldownMs: number;
  private circuitBreakers = new Map<string, CircuitBreakerStatus>();
  private adapterCache = new Map<string, ModelProviderAdapter>();

  constructor(options: FallbackRouterOptions) {
    this.endpoints = options.endpoints.length > 0 ? options.endpoints : DEFAULT_ZERO_COST_CHAIN;
    this.onFallback = options.onFallback;
    this.onEndpointSuccess = options.onEndpointSuccess;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 1500;
    this.cooldownMs = options.circuitBreakerCooldownMs ?? 60_000;
  }

  async checkEndpointHealth(endpoint: EndpointConfig): Promise<{ ok: boolean; reason?: string }> {
    if (!endpoint.isLocal && !endpoint.baseUrl) {
      return { ok: true };
    }

    const testUrl = endpoint.baseUrl?.replace(/\/v1\/?$/, '') || 'http://127.0.0.1:20128';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.healthTimeoutMs);
      const res = await fetch(`${testUrl}/models`, {
        method: 'GET',
        signal: controller.signal,
      }).catch(async () => {
        // Fallback to pinging root
        return fetch(testUrl, { method: 'GET', signal: controller.signal });
      });
      clearTimeout(timer);
      if (res.status >= 200 && res.status < 500) {
        return { ok: true };
      }
      return { ok: false, reason: `HTTP ${res.status}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  }

  private isAvailable(name: string): boolean {
    const status = this.circuitBreakers.get(name);
    if (!status) return true;
    if (Date.now() > status.failedUntil) {
      this.circuitBreakers.delete(name);
      return true;
    }
    return false;
  }

  private trip(name: string, reason: string): void {
    this.circuitBreakers.set(name, {
      failedUntil: Date.now() + this.cooldownMs,
      failureReason: reason,
    });
  }

  async *streamChat(params: {
    messages: Message[];
    tools: ToolDefinition[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    abortSignal?: AbortSignal;
  }): AsyncIterable<StreamChunk> {
    let lastError: string | undefined;

    for (let i = 0; i < this.endpoints.length; i++) {
      const endpoint = this.endpoints[i];

      if (!this.isAvailable(endpoint.name)) {
        continue;
      }

      // Pre-flight health check for local endpoints
      if (endpoint.isLocal) {
        const health = await this.checkEndpointHealth(endpoint);
        if (!health.ok) {
          this.trip(endpoint.name, health.reason ?? 'Health check failed');
          continue;
        }
      }

      let adapter = this.adapterCache.get(endpoint.name);
      if (!adapter) {
        try {
          adapter = await createAdapter(endpoint);
          this.adapterCache.set(endpoint.name, adapter);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.trip(endpoint.name, reason);
          continue;
        }
      }

      let errorOccurred = false;
      let errorMsg = '';
      let responded = false;

      try {
        const modelToUse = params.model && params.model !== 'default' ? params.model : endpoint.model;
        const stream = adapter.streamChat({
          ...params,
          model: modelToUse,
        });

        for await (const chunk of stream) {
          if (chunk.type === 'error') {
            errorOccurred = true;
            errorMsg = chunk.error ?? 'Unknown stream error';
            break;
          }
          responded = true;
          yield chunk;
        }
      } catch (err: unknown) {
        errorOccurred = true;
        errorMsg = err instanceof Error ? err.message : String(err);
      }

      if (params.abortSignal?.aborted) return;

      // Only an endpoint that actually streamed something counts as up.
      if (responded) {
        this.onEndpointSuccess?.(endpoint.name);
      }

      if (!errorOccurred) {
        // Success
        return;
      }

      // If an error occurred:
      lastError = errorMsg;
      this.trip(endpoint.name, errorMsg);

      const nextEndpoint = this.endpoints.slice(i + 1).find(ep => this.isAvailable(ep.name));
      const event: FallbackEvent = {
        fromEndpoint: endpoint.name,
        toEndpoint: nextEndpoint?.name ?? 'none',
        reason: errorMsg,
        timestamp: new Date().toISOString(),
      };

      if (this.onFallback) {
        this.onFallback(event);
      }

      if (nextEndpoint) {
        yield {
          type: 'text',
          content: `\n> *[Fallback: ${endpoint.name} unavailable (${errorMsg}). Switching to ${nextEndpoint.name}...]*\n\n`,
        };
      }
    }

    // If every endpoint was exhausted
    yield {
      type: 'error',
      error: `All fallback providers failed. Last error: ${lastError ?? 'Unknown'}`,
    };
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getEndpoints(): ReadonlyArray<EndpointConfig> {
    return this.endpoints;
  }

  getCircuitBreakerStatus(): ReadonlyMap<string, CircuitBreakerStatus> {
    return this.circuitBreakers;
  }
}

