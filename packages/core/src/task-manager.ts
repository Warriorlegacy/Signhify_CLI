import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface TaskNode {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'done';
  parentId?: string;
}

export class TaskManager {
  private workingDirectory: string;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
  }

  async createTask(title: string, parentId?: string): Promise<string> {
    const id = parentId ? `${parentId}.${Date.now().toString(36).slice(-4)}` : `T${Date.now().toString(36).slice(-6)}`;
    const content = `# Task: ${id}\n\n**Title:** ${title}\n**Status:** pending\n**Parent:** ${parentId ?? '(none)'}\n**Created:** ${new Date().toISOString()}\n\n## Progress\n\n`;
    await this.writeProgressFile(id, content);
    return id;
  }

  async startTask(id: string): Promise<void> {
    await this.updateStatus(id, 'in_progress');
  }

  async completeTask(id: string): Promise<void> {
    await this.updateStatus(id, 'done');
  }

  async blockTask(id: string, reason: string): Promise<void> {
    await this.appendToProgress(id, `\n## Blocked\n\n**Reason:** ${reason}\n**Time:** ${new Date().toISOString()}\n`);
    await this.updateStatus(id, 'blocked');
  }

  async appendToProgress(id: string, content: string): Promise<void> {
    const existing = await this.readProgressFile(id);
    await this.writeProgressFile(id, existing + content);
  }

  async readProgressFile(id: string): Promise<string> {
    const filePath = this.getProgressPath(id);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return `# Task: ${id}\n\n**Status:** unknown\n\n## Progress\n\n`;
    }
  }

  async writeProgressFile(id: string, content: string): Promise<void> {
    const filePath = this.getProgressPath(id);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  getActiveTask(): TaskNode | null {
    return null;
  }

  getTaskTree(): TaskNode[] {
    return [];
  }

  private getProgressPath(id: string): string {
    return path.join(this.workingDirectory, '.signhify', 'tasks', id, 'progress.md');
  }

  private async updateStatus(id: string, status: TaskNode['status']): Promise<void> {
    const existing = await this.readProgressFile(id);
    const updated = existing.replace(/\*\*Status:\*\* .*/, `**Status:** ${status}`);
    await this.writeProgressFile(id, updated);
  }
}
