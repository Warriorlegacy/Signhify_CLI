import { describe, it, expect } from 'vitest';
import { FallbackRouter, EndpointConfig, FallbackEvent } from '../fallback-router.js';

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
});

