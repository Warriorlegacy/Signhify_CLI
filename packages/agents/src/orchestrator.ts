import { Subagent, SubagentRole, SubagentTask, SubagentResult, SubagentContext } from './types.js';
import { FilePickerSubagent } from './file-picker.js';
import { PlannerSubagent } from './planner.js';
import { EditorSubagent } from './editor.js';
import { ReviewerSubagent } from './reviewer.js';
import { BrowserUseSubagent } from './browser-use.js';

export class SubagentOrchestrator {
  private registry = new Map<SubagentRole, Subagent>();
  private workingDirectory: string;
  private ctx: SubagentContext;

  /** Wire an adapter/model and (optionally) the task-tree store at construction. */
  constructor(workingDirectory: string, options?: SubagentContext) {
    this.workingDirectory = workingDirectory;
    this.ctx = options ?? {};
    this.registerSubagent(new FilePickerSubagent());
    this.registerSubagent(new PlannerSubagent());
    this.registerSubagent(new EditorSubagent());
    this.registerSubagent(new ReviewerSubagent());
    this.registerSubagent(new BrowserUseSubagent());
  }

  registerSubagent(agent: Subagent): void {
    this.registry.set(agent.role, agent);
  }

  getSubagent(role: SubagentRole): Subagent | undefined {
    return this.registry.get(role);
  }

  listSubagents(): Array<{ role: SubagentRole; name: string; description: string }> {
    return Array.from(this.registry.values()).map(a => ({
      role: a.role,
      name: a.name,
      description: a.description,
    }));
  }

  async dispatch(task: SubagentTask): Promise<SubagentResult> {
    const agent = this.registry.get(task.role);
    if (!agent) {
      return {
        success: false,
        output: '',
        error: `No subagent registered for role: "${task.role}". Available: ${Array.from(this.registry.keys()).join(', ')}`,
      };
    }

    return agent.run(task, this.workingDirectory, this.ctx);
  }

  async runPipeline(tasks: SubagentTask[]): Promise<SubagentResult[]> {
    const results: SubagentResult[] = [];
    for (const task of tasks) {
      const res = await this.dispatch(task);
      results.push(res);
      if (!res.success) {
        break; // stop pipeline on failure
      }
    }
    return results;
  }
}

