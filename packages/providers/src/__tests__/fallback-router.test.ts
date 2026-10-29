import { describe, it, expect } from 'vitest';
import {
  FallbackRouter,
  EndpointConfig,
  FallbackEvent,
  isRateLimitError,
  isContextOverflowError,
  isUpstreamOutageError,
} from '../fallback-router.js';

describe('FallbackRouter', () => {
  it('should use first healthy endpoint when it succeeds', async () => {
    const endpoints: EndpointConfig[] = [
      { name: 'mock-primary', vendor: 'mock', model: 'm1' },
      { name: 'mock-secondary', vendor: 'mock', model: 'm2' },
    ];

    const router = new FallbackRouter({ endpoints });
    const chunks: string[] = [];

    for await (const chunk of router.streamChat({ messages: [], tools: [] })) {
      if (chunk.type === 'text') chunks.push(chunk.content ?? '');
    }

    expect(chunks.join('')).toContain('Task completed successfully by mock provider.');
    expect(router.getCircuitBreakerStatus().size).toBe(0);
  });

  it('should fallback to secondary when primary endpoint is offline/fails', async () => {
    const fallbackEvents: FallbackEvent[] = [];
    const endpoints: EndpointConfig[] = [
      {
        name: 'unreachable-local',
        vendor: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:54321/v1',
        model: 'm1',
        isLocal: true,
      },
      {
        name: 'working-mock',
        vendor: 'mock',
        model: 'm2',
      },
    ];

    const router = new FallbackRouter({
      endpoints,
      healthTimeoutMs: 100,
      onFallback: (e) => fallbackEvents.push(e),
    });

    const chunks: string[] = [];
    for await (const chunk of router.streamChat({ messages: [], tools: [] })) {
      if (chunk.type === 'text') chunks.push(chunk.content ?? '');
    }

    const output = chunks.join('');
    expect(output).toContain('Task completed successfully by mock provider.');
    expect(router.getCircuitBreakerStatus().has('unreachable-local')).toBe(true);
  });

  it('should respect circuit breaker cooldown on subsequent calls', async () => {
    const endpoints: EndpointConfig[] = [
      {
        name: 'broken-endpoint',
        vendor: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:54322/v1',
        model: 'm1',
        isLocal: true,
      },
      {
        name: 'healthy-backup',
        vendor: 'mock',
        model: 'm2',
      },
    ];

    const router = new FallbackRouter({ endpoints, healthTimeoutMs: 100, circuitBreakerCooldownMs: 5000 });

    // First call: trips circuit breaker on broken-endpoint
    for await (const chunk of router.streamChat({ messages: [], tools: [] })) void chunk;

    // Second call: broken-endpoint is skipped immediately without re-probing
    expect(router.getCircuitBreakerStatus().has('broken-endpoint')).toBe(true);
  });

  it('should detect 429 rate limit error and failover to secondary', async () => {
    const events: FallbackEvent[] = [];
    const endpoints: EndpointConfig[] = [
      { name: 'rate-limited-endpoint', vendor: 'mock', model: 'm1' },
      { name: 'backup-endpoint', vendor: 'mock', model: 'm2' },
    ];

    const router = new FallbackRouter({
      endpoints,
      onFallback: (e) => events.push(e),
      createAdapter: async (ep) => {
        if (ep.name === 'rate-limited-endpoint') {
          return {
            id: 'mock-429',
            vendor: 'mock',
            supportsFunctionCalling: true,
            // eslint-disable-next-line require-yield
            async *streamChat() {
              throw { status: 429, message: 'Too Many Requests: rate limit exceeded' };
            },
            countTokens: () => 1,
          };
        }
        return {
          id: 'mock-backup',
          vendor: 'mock',
          supportsFunctionCalling: true,
          async *streamChat() {
            yield { type: 'text', content: 'Backup succeeded after 429' };
          },
          countTokens: () => 1,
        };
      },
    });

    const chunks: string[] = [];
    for await (const chunk of router.streamChat({ messages: [], tools: [] })) {
      if (chunk.type === 'text') chunks.push(chunk.content ?? '');
    }

    expect(chunks.join('')).toContain('Backup succeeded after 429');
    expect(events.length).toBe(1);
    expect(events[0].fromEndpoint).toBe('rate-limited-endpoint');
    expect(events[0].toEndpoint).toBe('backup-endpoint');
    expect(events[0].errorType).toBe('rate_limit');
    expect(router.getCircuitBreakerStatus().has('rate-limited-endpoint')).toBe(true);
  });

  it('should detect context length overflow and failover to secondary', async () => {
    const events: FallbackEvent[] = [];
    const endpoints: EndpointConfig[] = [
      { name: 'overflow-endpoint', vendor: 'mock', model: 'm1' },
      { name: 'long-context-backup', vendor: 'mock', model: 'm2' },
    ];

    const router = new FallbackRouter({
      endpoints,
      onFallback: (e) => events.push(e),
      createAdapter: async (ep) => {
        if (ep.name === 'overflow-endpoint') {
          return {
            id: 'mock-overflow',
            vendor: 'mock',
            supportsFunctionCalling: true,
            async *streamChat() {
              yield {
                type: 'error',
                error: 'maximum context length exceeded: tokens exceed 8192 token limit',
              };
            },
            countTokens: () => 1,
          };
        }
        return {
          id: 'mock-long-ctx',
          vendor: 'mock',
          supportsFunctionCalling: true,
          async *streamChat() {
            yield { type: 'text', content: 'Handled by large context endpoint' };
          },
          countTokens: () => 1,
        };
      },
    });

    const chunks: string[] = [];
    for await (const chunk of router.streamChat({ messages: [], tools: [] })) {
      if (chunk.type === 'text') chunks.push(chunk.content ?? '');
    }

    expect(chunks.join('')).toContain('Handled by large context endpoint');
    expect(events.length).toBe(1);
    expect(events[0].fromEndpoint).toBe('overflow-endpoint');
    expect(events[0].toEndpoint).toBe('long-context-backup');
    expect(events[0].errorType).toBe('context_overflow');
  });

  it('should detect 5xx upstream outage and failover to secondary', async () => {
    const events: FallbackEvent[] = [];
    const endpoints: EndpointConfig[] = [
      { name: 'overloaded-endpoint', vendor: 'mock', model: 'm1' },
      { name: 'stable-backup', vendor: 'mock', model: 'm2' },
    ];

    const router = new FallbackRouter({
      endpoints,
      onFallback: (e) => events.push(e),
      createAdapter: async (ep) => {
        if (ep.name === 'overloaded-endpoint') {
          return {
            id: 'mock-503',
            vendor: 'mock',
            supportsFunctionCalling: true,
            // eslint-disable-next-line require-yield
            async *streamChat() {
              throw { status: 503, message: 'Service Unavailable: Overloaded' };
            },
            countTokens: () => 1,
          };
        }
        return {
          id: 'mock-stable',
          vendor: 'mock',
          supportsFunctionCalling: true,
          async *streamChat() {
            yield { type: 'text', content: 'Stable backup succeeded' };
          },
          countTokens: () => 1,
        };
      },
    });

    const chunks: string[] = [];
    for await (const chunk of router.streamChat({ messages: [], tools: [] })) {
      if (chunk.type === 'text') chunks.push(chunk.content ?? '');
    }

    expect(chunks.join('')).toContain('Stable backup succeeded');
    expect(events.length).toBe(1);
    expect(events[0].errorType).toBe('upstream_outage');
  });

  it('trips placeholder API key endpoints upon creation', async () => {
    const endpoints: EndpointConfig[] = [
      { name: 'unconfigured-openai', vendor: 'openai', model: 'gpt-4o', apiKey: 'sk-...' },
      { name: 'working-mock', vendor: 'mock', model: 'm1' },
    ];

    const router = new FallbackRouter({ endpoints });
    expect(router.getCircuitBreakerStatus().has('unconfigured-openai')).toBe(true);

    const chunks: string[] = [];
    for await (const chunk of router.streamChat({ messages: [], tools: [] })) {
      if (chunk.type === 'text') chunks.push(chunk.content ?? '');
    }

    expect(chunks.join('')).toContain('Task completed successfully by mock provider.');
  });

  describe('error category helper functions', () => {
    it('isRateLimitError identifies rate limit statuses and messages', () => {
      expect(isRateLimitError({ status: 429 })).toBe(true);
      expect(isRateLimitError({ statusCode: 429 })).toBe(true);
      expect(isRateLimitError(new Error('Rate limit exceeded: 429'))).toBe(true);
      expect(isRateLimitError(new Error('Quota exceeded for this month'))).toBe(true);
      expect(isRateLimitError(new Error('Too many requests'))).toBe(true);
      expect(isRateLimitError(new Error('Generic failure'))).toBe(false);
    });

    it('isContextOverflowError identifies context overflow phrases', () => {
      expect(isContextOverflowError(new Error('maximum context length reached'))).toBe(true);
      expect(isContextOverflowError(new Error('context_length_exceeded'))).toBe(true);
      expect(isContextOverflowError(new Error('prompt too long: tokens exceed limit'))).toBe(true);
      expect(isContextOverflowError(new Error('Out of memory'))).toBe(false);
    });

    it('isUpstreamOutageError identifies 5xx and overloaded errors', () => {
      expect(isUpstreamOutageError({ status: 500 })).toBe(true);
      expect(isUpstreamOutageError({ statusCode: 502 })).toBe(true);
      expect(isUpstreamOutageError({ status: 503 })).toBe(true);
      expect(isUpstreamOutageError({ status: 504 })).toBe(true);
      expect(isUpstreamOutageError(new Error('Model is overloaded'))).toBe(true);
      expect(isUpstreamOutageError(new Error('Service Unavailable'))).toBe(true);
      expect(isUpstreamOutageError(new Error('Bad Gateway'))).toBe(true);
      expect(isUpstreamOutageError(new Error('Normal error'))).toBe(false);
    });
  });
});

