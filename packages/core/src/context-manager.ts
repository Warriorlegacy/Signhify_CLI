import { Message } from './types.js';

export interface ContextAssemblyResult {
  messages: Message[];
  totalTokens: number;
  compactedCount?: number;
}

export class ContextManager {
  private tokenBudget: number;
  private checkpointThresholdPct: number;
  private contextLimit: number;
  private recentWindow: number;

  constructor(config?: {
    tokenBudget?: number;
    checkpointThresholdPct?: number;
    contextLimit?: number;
    /** Turns always kept verbatim (T3.4 tier 1). */
    recentWindow?: number;
  }) {
    this.tokenBudget = config?.tokenBudget ?? 4000;
    this.checkpointThresholdPct = config?.checkpointThresholdPct ?? 80;
    this.contextLimit = config?.contextLimit ?? 128_000;
    this.recentWindow = config?.recentWindow ?? 20;
  }

  assembleContext(params: {
    systemPrompt: string;
    memoryContent?: string;
    checkpointContent?: string;
    taskProgress?: string;
    recentMessages: Message[];
  }): ContextAssemblyResult {
    const messages: Message[] = [];

    let systemContent = params.systemPrompt;
    if (params.memoryContent) {
      systemContent += `\n\n## Project Memory\n${params.memoryContent}`;
    }
    if (params.checkpointContent) {
      systemContent += `\n\n## Previous Session\n${params.checkpointContent}`;
    }
    if (params.taskProgress) {
      systemContent += `\n\n## Task Progress\n${params.taskProgress}`;
    }

    const systemMsg: Message = { role: 'system', content: systemContent };
    messages.push(systemMsg);

    const systemTokens = this.estimateTokens(systemContent);
    const availableBudget = Math.max(0, Math.min(this.contextLimit, this.tokenBudget) - systemTokens);

    // T3.4 progressive pruning, applied oldest-tier-first:
    //   tier 1 — the last `recentWindow` turns stay verbatim (within budget);
    //   tier 2 — older turns are summarised into the [Context Notice] line;
    //   tier 3 — tool outputs older than the window are dropped outright.
    const all = params.recentMessages;
    const window = all.slice(Math.max(0, all.length - this.recentWindow));
    const olderStart = all.length - window.length;

    const olderConversation: Message[] = []; // tier 2 digest source (chronological)
    const olderToolOutputs: Message[] = []; // tier 3, dropped
    for (let i = 0; i < olderStart; i++) {
      (all[i].role === 'tool' ? olderToolOutputs : olderConversation).push(all[i]);
    }

    // Never split an assistant(toolCalls)/tool-result pair across the window
    // boundary: an opening tool result has no caller inside the window, so it
    // moves to the dropped tier instead.
    while (window.length > 0 && window[0].role === 'tool') {
      olderToolOutputs.push(window.shift() as Message);
    }

    // Verbatim walk, newest→oldest, cutting at the first overrun so the kept
    // tail stays contiguous (no holes between a kept reply and its question).
    const included: Message[] = [];
    const frontier: Message[] = [];
    let currentTokens = 0;
    let frontierReached = false;

    for (let i = window.length - 1; i >= 0; i--) {
      const msg = window[i];
      const msgTokens = this.estimateTokens(msg.content);
      if (!frontierReached && currentTokens + msgTokens <= availableBudget) {
        included.unshift(msg);
        currentTokens += msgTokens;
      } else {
        frontierReached = true;
        frontier.unshift(msg); // becomes part of the summarised tier
      }
    }
    olderConversation.push(...frontier);

    const compactedCount = all.length - included.length;

    if (compactedCount > 0) {
      let digest = '';
      const oldestRequest = olderConversation.find(m => m.role === 'user');
      if (oldestRequest) {
        digest = ` Oldest request: "${oldestRequest.content.slice(0, 120)}".`;
      }
      messages.push({
        role: 'system',
        content:
          `[Context Notice: ${compactedCount} earlier message(s) compacted ` +
          `(${olderConversation.length} summarised, ${olderToolOutputs.length} tool outputs dropped).` +
          `${digest} State preserved in checkpoints and MEMORY.md.]`,
      });
    }

    messages.push(...included);

    const noticeTokens = compactedCount > 0 ? this.estimateTokens(messages[1].content) : 0;

    return {
      messages,
      totalTokens: systemTokens + noticeTokens + currentTokens,
      compactedCount,
    };
  }

  shouldCheckpoint(totalTokens: number, contextWindow?: number): boolean {
    const window = contextWindow ?? this.contextLimit;
    const usagePct = (totalTokens / window) * 100;
    return usagePct >= this.checkpointThresholdPct;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  setTokenBudget(budget: number): void {
    this.tokenBudget = budget;
  }

  getTokenBudget(): number {
    return this.tokenBudget;
  }

  setContextLimit(limit: number): void {
    this.contextLimit = limit;
  }

  getContextLimit(): number {
    return this.contextLimit;
  }
}
