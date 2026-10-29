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

  it('T3.4: 200-message session prunes in order and reports accurate compactedCount', () => {
    // Huge budget: pruning must be driven by the window, not by token pressure.
    const cm = new ContextManager({ tokenBudget: 100_000, contextLimit: 200_000 });
    const messages: Message[] = [];
    for (let i = 0; i < 200; i++) {
      messages.push(
        i % 3 === 0
          ? { role: 'user', content: `user turn ${i}` }
          : i % 3 === 1
            ? { role: 'assistant', content: `assistant turn ${i}` }
            : { role: 'tool', content: `tool output ${i}` },
      );
    }

    const result = cm.assembleContext({ systemPrompt: 'sys', recentMessages: messages });

    // Tier 1: exactly the last 20 turns stay verbatim; everything older is
    // compacted (tier 2 digest + tier 3 tool drops) and counted accurately.
    expect(result.compactedCount).toBe(180);
    expect(result.messages).toHaveLength(22); // system + notice + 20 verbatim

    // Order: notice directly after the system message, then the verbatim tail
    // in chronological order, newest last.
    const notice = result.messages[1];
    expect(notice.content).toContain('[Context Notice: 180 earlier message(s) compacted');
    expect(notice.content).toContain('(120 summarised, 60 tool outputs dropped)');
    expect(notice.content).toContain('Oldest request: "user turn 0"');
    expect(result.messages[2].content).toBe('user turn 180');
    expect(result.messages[result.messages.length - 1].content).toBe('assistant turn 199');

    // Tier 3: tool outputs older than the window are gone, younger ones kept.
    expect(result.messages.some(m => m.content === 'tool output 176')).toBe(false);
    expect(result.messages.some(m => m.content === 'tool output 197')).toBe(true);
  });

  it('T3.4: window boundary never splits an assistant/tool-result pair', () => {
    const cm = new ContextManager({ tokenBudget: 1_000_000, recentWindow: 20 });
    const messages: Message[] = [
      {
        role: 'assistant',
        content: 'run probes',
        toolCalls: [
          { id: 'c1', name: 'shell', arguments: {} },
          { id: 'c2', name: 'shell', arguments: {} },
        ],
      },
      { role: 'tool', content: 'result c1', toolCallId: 'c1' },
      { role: 'tool', content: 'result c2', toolCallId: 'c2' },
      { role: 'user', content: 'next step' },
    ];
    for (let i = 0; i < 17; i++) {
      messages.push(i % 2 === 0 ? { role: 'user', content: `q${i}` } : { role: 'assistant', content: `a${i}` });
    }

    const result = cm.assembleContext({ systemPrompt: 'sys', recentMessages: messages });

    // 21 messages, 20-window would start on an orphaned tool result: both
    // opening tool outputs are dropped with their (summarised) caller.
    expect(result.compactedCount).toBe(3);
    expect(result.messages[1].content).toContain('(1 summarised, 2 tool outputs dropped)');
    expect(result.messages[2].content).toBe('next step');
  });

  it('T3.4: budget frontier truncates the verbatim tail contiguously', () => {
    const cm = new ContextManager({ tokenBudget: 60 });
    const messages: Message[] = [
      { role: 'user', content: 'long earliest message that alone would overflow what remains'.repeat(4) },
      { role: 'user', content: 'medium middle message taking a comfortable slice of budget'.repeat(4) },
      { role: 'assistant', content: 'short newest answer' },
    ];

    const result = cm.assembleContext({ systemPrompt: 'sys', recentMessages: messages });

    // Newest fits; the middle overruns the remainder, so the earliest is cut
    // with it (no hole): one kept, two compacted.
    expect(result.compactedCount).toBe(2);
    expect(result.messages).toHaveLength(3); // system + notice + 1 verbatim
    expect(result.messages[result.messages.length - 1].content).toBe('short newest answer');
    expect(result.messages[1].content).toContain('Oldest request: "long earliest message');
  });
});
