import { MemoryStore, MemoryEntry } from './memory-store.js';
import { MemoryMdManager } from './memory-md.js';

export interface DreamResult {
  entriesExtracted: number;
  entriesPruned: number;
  summary: string;
}

export interface DistillResult {
  patternsDetected: number;
  agentsCreated: number;
  summary: string;
}

export class DreamDistillEngine {
  private memoryStore: MemoryStore;
  private memoryMd: MemoryMdManager;

  constructor(memoryStore: MemoryStore, memoryMd: MemoryMdManager) {
    this.memoryStore = memoryStore;
    this.memoryMd = memoryMd;
  }

  async dream(projectId: string, sessionTraces: string[]): Promise<DreamResult> {
    let entriesExtracted = 0;
    const extractedEntries: string[] = [];

    for (const trace of sessionTraces) {
      const knowledge = this.extractKnowledge(trace);
      for (const item of knowledge) {
        this.memoryStore.addEntry({
          projectId,
          category: item.category,
          content: item.content,
          importance: item.importance,
        });
        entriesExtracted++;
        extractedEntries.push(item.content);
      }
    }

    const entriesPruned = this.memoryStore.deleteStale(projectId);

    for (const entry of extractedEntries) {
      await this.memoryMd.appendEntry('Auto-extracted Knowledge', entry);
    }

    return {
      entriesExtracted,
      entriesPruned,
      summary: `Extracted ${entriesExtracted} knowledge items, pruned ${entriesPruned} stale entries.`,
    };
  }

  async distill(projectId: string, sessionTraces: string[]): Promise<DistillResult> {
    const patterns = this.detectPatterns(sessionTraces);

    let agentsCreated = 0;
    for (const pattern of patterns) {
      this.memoryStore.addEntry({
        projectId,
        category: 'convention',
        content: `Reusable pattern: ${pattern.name} — ${pattern.description}`,
        importance: 0.8,
      });
      agentsCreated++;
    }

    return {
      patternsDetected: patterns.length,
      agentsCreated,
      summary: `Detected ${patterns.length} patterns, created ${agentsCreated} reusable agents.`,
    };
  }

  private extractKnowledge(trace: string): Array<{ category: MemoryEntry['category']; content: string; importance: number }> {
    const knowledge: Array<{ category: MemoryEntry['category']; content: string; importance: number }> = [];
    const lines = trace.split('\n');

    for (const line of lines) {
      if (line.toLowerCase().includes('decided to') || line.toLowerCase().includes('chosen approach')) {
        knowledge.push({ category: 'decision', content: line.trim(), importance: 0.7 });
      }
      if (line.toLowerCase().includes('convention') || line.toLowerCase().includes('pattern')) {
        knowledge.push({ category: 'convention', content: line.trim(), importance: 0.6 });
      }
      if (line.toLowerCase().includes('must always') || line.toLowerCase().includes('never')) {
        knowledge.push({ category: 'rule', content: line.trim(), importance: 0.9 });
      }
    }

    return knowledge;
  }

  private detectPatterns(traces: string[]): Array<{ name: string; description: string }> {
    const patterns: Array<{ name: string; description: string }> = [];
    const commandFrequency = new Map<string, number>();

    for (const trace of traces) {
      const commands = trace.match(/```(?:bash|sh)\n([\s\S]*?)```/g) ?? [];
      for (const cmd of commands) {
        const cleaned = cmd.replace(/```(?:bash|sh)\n?/g, '').replace(/```/g, '').trim();
        commandFrequency.set(cleaned, (commandFrequency.get(cleaned) ?? 0) + 1);
      }
    }

    for (const [command, count] of commandFrequency) {
      if (count >= 3) {
        patterns.push({
          name: `workflow-${patterns.length + 1}`,
          description: `Repeated workflow: ${command.slice(0, 100)}`,
        });
      }
    }

    return patterns;
  }
}
