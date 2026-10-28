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

  constructor(config?: {
    tokenBudget?: number;
    checkpointThresholdPct?: number;
    contextLimit?: number;
  }) {
    this.tokenBudget = config?.tokenBudget ?? 4000;
    this.checkpointThresholdPct = config?.checkpointThresholdPct ?? 80;
    this.contextLimit = config?.contextLimit ?? 128_000;
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

    // Sliding-window compaction: keep most recent messages first
    const includedMessages: Message[] = [];
    let currentTokens = 0;
    let compactedCount = 0;

    for (let i = params.recentMessages.length - 1; i >= 0; i--) {
      const msg = params.recentMessages[i];
      const msgTokens = this.estimateTokens(msg.content);
      if (currentTokens + msgTokens <= availableBudget) {
        includedMessages.unshift(msg);
        currentTokens += msgTokens;
      } else {
        compactedCount++;
      }
    }

    if (compactedCount > 0) {
      messages.push({
        role: 'system',
        content: `[Context Notice: ${compactedCount} earlier message(s) compacted. State preserved in checkpoints and MEMORY.md.]`,
      });
    }

    messages.push(...includedMessages);

    return {
      messages,
      totalTokens: systemTokens + currentTokens,
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
