import { Message } from './types.js';

export interface ContextAssemblyResult {
  messages: Message[];
  totalTokens: number;
}

export class ContextManager {
  private tokenBudget: number;
  private checkpointThresholdPct: number;

  constructor(config?: { tokenBudget?: number; checkpointThresholdPct?: number }) {
    this.tokenBudget = config?.tokenBudget ?? 4000;
    this.checkpointThresholdPct = config?.checkpointThresholdPct ?? 80;
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

    messages.push({ role: 'system', content: systemContent });

    let tokenCount = this.estimateTokens(systemContent);
    for (const msg of params.recentMessages) {
      const msgTokens = this.estimateTokens(msg.content);
      if (tokenCount + msgTokens > this.tokenBudget) break;
      messages.push(msg);
      tokenCount += msgTokens;
    }

    return { messages, totalTokens: tokenCount };
  }

  shouldCheckpoint(totalTokens: number, contextWindow: number): boolean {
    const usagePct = (totalTokens / contextWindow) * 100;
    return usagePct >= this.checkpointThresholdPct;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  setTokenBudget(budget: number): void {
    this.tokenBudget = budget;
  }
}
