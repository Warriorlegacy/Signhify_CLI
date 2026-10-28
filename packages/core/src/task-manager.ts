import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface TaskNode {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'done';
  parentId?: string;
  children?: TaskNode[];
}

export class TaskManager {
  private workingDirectory: string;
  private tasks: Map<string, TaskNode> = new Map();
  private initialized = false;

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const tasksDir = path.join(this.workingDirectory, '.signhify', 'tasks');
    try {
      const entries = await fs.readdir(tasksDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const id = entry.name;
          const progressPath = path.join(tasksDir, id, 'progress.md');
          try {
            const content = await fs.readFile(progressPath, 'utf-8');
            const titleMatch = content.match(/\*\*Title:\*\* (.*)/);
            const statusMatch = content.match(/\*\*Status:\*\* (.*)/);
            const parentMatch = content.match(/\*\*Parent:\*\* (.*)/);

            const title = titleMatch ? titleMatch[1].trim() : id;
            const rawStatus = statusMatch ? statusMatch[1].trim() : 'pending';
            const status = (['pending', 'in_progress', 'blocked', 'done'].includes(rawStatus)
              ? rawStatus
              : 'pending') as TaskNode['status'];
            const parentId = parentMatch && parentMatch[1] !== '(none)' ? parentMatch[1].trim() : undefined;

            this.tasks.set(id, { id, title, status, parentId });
          } catch {
            // progress file unreadable
          }
        }
      }
    } catch {
      // directory does not exist yet
    }
  }

  private generateId(parentId?: string): string {
    if (!parentId) {
      // Find highest root T<n>
      let highest = 0;
      for (const id of this.tasks.keys()) {
        const match = id.match(/^T(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > highest) highest = num;
        }
      }
      return `T${highest + 1}`;
    }

    // Find highest child of parentId
    let highestChild = 0;
    const prefix = `${parentId}.`;
    for (const id of this.tasks.keys()) {
      if (id.startsWith(prefix)) {
        const sub = id.slice(prefix.length);
        const num = parseInt(sub, 10);
        if (!isNaN(num) && num > highestChild) {
          highestChild = num;
        }
      }
    }
    return `${parentId}.${highestChild + 1}`;
  }

  async createTask(title: string, parentId?: string): Promise<string> {
    await this.initialize();
    const id = this.generateId(parentId);
    const node: TaskNode = {
      id,
      title,
      status: 'pending',
      parentId,
    };
    this.tasks.set(id, node);

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
    // Return first in_progress task, else first pending task
    for (const task of this.tasks.values()) {
      if (task.status === 'in_progress') return task;
    }
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') return task;
    }
    return null;
  }

  getTaskTree(): TaskNode[] {
    const list = Array.from(this.tasks.values());
    // Natural sort: T1, T1.1, T1.2, T2, T2.1
    return list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  private getProgressPath(id: string): string {
    return path.join(this.workingDirectory, '.signhify', 'tasks', id, 'progress.md');
  }

  private async updateStatus(id: string, status: TaskNode['status']): Promise<void> {
    const task = this.tasks.get(id);
    if (task) {
      task.status = status;
    }
    const existing = await this.readProgressFile(id);
    const updated = existing.replace(/\*\*Status:\*\* .*/, `**Status:** ${status}`);
    await this.writeProgressFile(id, updated);
  }
}
