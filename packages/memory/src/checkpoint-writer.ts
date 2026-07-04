import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MemoryStore } from './memory-store.js';

export interface CheckpointData {
  sessionId: string;
  summary: string;
  tokenUsage: number;
  decisions: string[];
  currentDiffs: string[];
  openIssues: string[];
}

export interface CheckpointFileContent {
  timestamp: string;
  sessionId: string;
  summary: string;
  tokenUsage: number;
  sections: {
    decisions: string[];
    activeDiffs: string[];
    openIssues: string[];
    taskProgress: string;
  };
}

export class CheckpointWriter {
  private memoryStore: MemoryStore;
  private projectDir: string;

  constructor(memoryStore: MemoryStore, projectDir: string) {
    this.memoryStore = memoryStore;
    this.projectDir = projectDir;
  }

  async writeCheckpoint(data: CheckpointData): Promise<string> {
    const dbStmt = (this.memoryStore as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } }).db.prepare(`
      INSERT INTO checkpoints (session_id, summary, token_usage_at_checkpoint)
      VALUES (?, ?, ?)
    `);
    dbStmt.run(data.sessionId, data.summary, data.tokenUsage);

    const content: CheckpointFileContent = {
      timestamp: new Date().toISOString(),
      sessionId: data.sessionId,
      summary: data.summary,
      tokenUsage: data.tokenUsage,
      sections: {
        decisions: data.decisions,
        activeDiffs: data.currentDiffs,
        openIssues: data.openIssues,
        taskProgress: '',
      },
    };

    const markdown = this.formatCheckpointMarkdown(content);
    const signhifyDir = path.join(this.projectDir, '.signhify');
    await fs.mkdir(signhifyDir, { recursive: true });
    const filePath = path.join(signhifyDir, 'checkpoint.md');
    await fs.writeFile(filePath, markdown, 'utf-8');

    return filePath;
  }

  async readLatestCheckpoint(): Promise<CheckpointFileContent | null> {
    const filePath = path.join(this.projectDir, '.signhify', 'checkpoint.md');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.parseCheckpointMarkdown(content);
    } catch {
      return null;
    }
  }

  private formatCheckpointMarkdown(data: CheckpointFileContent): string {
    const lines = [
      `# Session Checkpoint`,
      ``,
      `**Session ID:** ${data.sessionId}`,
      `**Timestamp:** ${data.timestamp}`,
      `**Token Usage:** ${data.tokenUsage}`,
      ``,
      `## Summary`,
      data.summary,
      ``,
      `## Decisions`,
      ...data.sections.decisions.map(d => `- ${d}`),
      ``,
      `## Active Diffs`,
      ...data.sections.activeDiffs.map(d => `- ${d}`),
      ``,
      `## Open Issues`,
      ...data.sections.openIssues.map(i => `- ${i}`),
      ``,
      `## Task Progress`,
      data.sections.taskProgress || '(none)',
    ];
    return lines.join('\n');
  }

  private parseCheckpointMarkdown(content: string): CheckpointFileContent {
    const sessionId = content.match(/\*\*Session ID:\*\*\s*(.+)/)?.[1]?.trim() ?? '';
    const timestamp = content.match(/\*\*Timestamp:\*\*\s*(.+)/)?.[1]?.trim() ?? '';
    const tokenUsage = parseInt(content.match(/\*\*Token Usage:\*\*\s*(\d+)/)?.[1] ?? '0', 10);

    const extractSection = (heading: string): string[] => {
      const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
      const match = content.match(regex);
      return match ? match[1].trim().split('\n').map(l => l.replace(/^- /, '')).filter(Boolean) : [];
    };

    return {
      timestamp,
      sessionId,
      summary: content.match(/## Summary\n([\s\S]*?)(?=\n## )/)?.[1]?.trim() ?? '',
      tokenUsage,
      sections: {
        decisions: extractSection('Decisions'),
        activeDiffs: extractSection('Active Diffs'),
        openIssues: extractSection('Open Issues'),
        taskProgress: content.match(/## Task Progress\n([\s\S]*?)$/)?.[1]?.trim() ?? '',
      },
    };
  }
}
