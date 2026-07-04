import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface MemorySection {
  category: string;
  entries: string[];
}

export class MemoryMdManager {
  private projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  async readMemoryMd(): Promise<string> {
    const filePath = path.join(this.projectDir, '.signhify', 'MEMORY.md');
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  async writeMemoryMd(content: string): Promise<void> {
    const signhifyDir = path.join(this.projectDir, '.signhify');
    await fs.mkdir(signhifyDir, { recursive: true });
    await fs.writeFile(path.join(signhifyDir, 'MEMORY.md'), content, 'utf-8');
  }

  async appendEntry(category: string, entry: string): Promise<void> {
    const existing = await this.readMemoryMd();
    const sectionHeader = `## ${category}`;
    const entryLine = `- ${entry} (${new Date().toISOString().split('T')[0]})`;

    if (existing.includes(sectionHeader)) {
      const idx = existing.indexOf(sectionHeader);
      const nextSection = existing.indexOf('\n## ', idx + sectionHeader.length);
      const insertPoint = nextSection === -1 ? existing.length : nextSection;
      const updated = existing.slice(0, insertPoint) + '\n' + entryLine + '\n' + existing.slice(insertPoint);
      await this.writeMemoryMd(updated);
    } else {
      const updated = existing + (existing ? '\n\n' : '') + sectionHeader + '\n' + entryLine + '\n';
      await this.writeMemoryMd(updated);
    }
  }

  async readNotesMd(): Promise<string> {
    const filePath = path.join(this.projectDir, '.signhify', 'notes.md');
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  async writeNotesMd(content: string): Promise<void> {
    const signhifyDir = path.join(this.projectDir, '.signhify');
    await fs.mkdir(signhifyDir, { recursive: true });
    await fs.writeFile(path.join(signhifyDir, 'notes.md'), content, 'utf-8');
  }

  async readTaskProgress(taskId: string): Promise<string> {
    const filePath = path.join(this.projectDir, '.signhify', 'tasks', taskId, 'progress.md');
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  async writeTaskProgress(taskId: string, content: string): Promise<void> {
    const taskDir = path.join(this.projectDir, '.signhify', 'tasks', taskId);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(path.join(taskDir, 'progress.md'), content, 'utf-8');
  }
}
