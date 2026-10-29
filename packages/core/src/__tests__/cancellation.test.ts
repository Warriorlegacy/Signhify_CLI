import { describe, it, expect } from 'vitest';
import { AgentLoop, ToolHandler, ModelProviderAdapter } from '../agent-loop.js';
import { SignhifyConfig, StreamChunk } from '../types.js';
import { AbortError } from '../errors.js';

const mockConfig: SignhifyConfig = {
  provider: {
    agent: { vendor: 'openai', model: 'gpt-4', apiKey: 'test-key' },
  },
  memory: { tokenBudget: 4000, checkpointThresholdPct: 80 },
};

function createMockProvider(
  streamChatFn: (params: {
    messages: any[];
    tools: any[];
    model: string;
    abortSignal?: AbortSignal;
  }) => AsyncIterable<StreamChunk>,
): ModelProviderAdapter {
  return {
    id: 'mock-provider',
    vendor: 'openai',
    supportsFunctionCalling: true,
    countTokens: () => 10,
    streamChat: streamChatFn,
  };
}

describe('AgentLoop Cancellation', () => {
  it('returns cancelled result immediately if signal is already aborted', async () => {
    let providerCalled = false;
    const mockProvider = createMockProvider(async function* () {
      providerCalled = true;
      yield { type: 'text', text: 'hello' };
    });

    const loop = new AgentLoop({
      config: mockConfig,
      workingDirectory: '/tmp/test',
      provider: mockProvider,
    });

    const controller = new AbortController();
    controller.abort();

    const result = await loop.run('test prompt', controller.signal);
    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Run cancelled by user');
    expect(providerCalled).toBe(false);
  });

  it('gracefully cancels when a tool execution is aborted and throws AbortError', async () => {
    const controller = new AbortController();

    const mockProvider = createMockProvider(async function* () {
      yield {
        type: 'tool_call',
        toolCall: {
          id: 'call-1',
          name: 'shell-exec',
          arguments: { command: 'node test.js' },
        },
      };
    });

    let toolStarted = false;
    let toolAborted = false;

    const longRunningTool: ToolHandler = {
      name: 'shell-exec',
      description: 'A tool that simulates long running work until aborted',
      parameters: {},
      async execute(_args, context) {
        toolStarted = true;
        if (context.signal?.aborted) {
          throw new AbortError('Operation aborted');
        }

        return new Promise<string>((_resolve, reject) => {
          const onAbort = () => {
            toolAborted = true;
            context.signal?.removeEventListener('abort', onAbort);
            reject(new AbortError('Operation aborted'));
          };

          context.signal?.addEventListener('abort', onAbort);
        });
      },
    };

    const loop = new AgentLoop({
      config: mockConfig,
      workingDirectory: '/tmp/test',
      provider: mockProvider,
      autoMode: true,
    });
    loop.registerTool(longRunningTool);

    const runPromise = loop.run('execute long tool', controller.signal);

    // Wait until the tool has actually started executing
    for (let i = 0; i < 50; i++) {
      if (toolStarted) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(toolStarted).toBe(true);

    // Abort the controller
    controller.abort();

    const result = await runPromise;
    expect(toolAborted).toBe(true);
    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Run cancelled by user');
  });

  it('cancels gracefully if provider call throws AbortError', async () => {
    const controller = new AbortController();

    // eslint-disable-next-line require-yield
    const mockProvider = createMockProvider(async function* (options) {
      if (options.abortSignal?.aborted) {
        throw new AbortError('Provider request aborted');
      }
      controller.abort();
      throw new AbortError('Provider request aborted');
    });

    const loop = new AgentLoop({
      config: mockConfig,
      workingDirectory: '/tmp/test',
      provider: mockProvider,
    });

    const result = await loop.run('prompt', controller.signal);
    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
  });
});
