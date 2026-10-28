import { describe, it, expect } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { Message } from '../types.js';

describe('ContextManager', () => {
  it('should assemble system prompt and recent messages within budget', () => {
    const cm = new ContextManager({ tokenBudget: 2000, contextLimit: 4000 });
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];

    const result = cm.assembleContext({
      systemPrompt: 'You are an AI assistant.',
      recentMessages: messages,
    });

    expect(result.messages.length).toBe(3); // system + user + assistant
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.compactedCount).toBe(0);
  });

  it('should compact older messages when exceeding budget and retain newest messages', () => {
    // Very tight budget to force compaction
    const cm = new ContextManager({ tokenBudget: 25 });
    const messages: Message[] = [
      { role: 'user', content: 'Turn 1: A very long message that takes up considerable tokens in the prompt.'.repeat(3) },
      { role: 'assistant', content: 'Turn 1 Response: Another long message taking up tokens.'.repeat(3) },
      { role: 'user', content: 'Turn 2: Most recent message' },
    ];

    const result = cm.assembleContext({
      systemPrompt: 'System',
      recentMessages: messages,
    });

    expect(result.compactedCount).toBeGreaterThan(0);
    // The most recent message must be preserved
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Turn 2: Most recent message');
  });

  it('should trigger checkpoint when exceeding threshold percentage', () => {
    const cm = new ContextManager({ checkpointThresholdPct: 80, contextLimit: 1000 });
    expect(cm.shouldCheckpoint(700, 1000)).toBe(false);
    expect(cm.shouldCheckpoint(800, 1000)).toBe(true);
    expect(cm.shouldCheckpoint(850, 1000)).toBe(true);
  });
});
