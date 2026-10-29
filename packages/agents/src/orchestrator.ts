import { Subagent, SubagentRole, SubagentTask, SubagentResult, SubagentContext } from './types.js';
import { FilePickerSubagent } from './file-picker.js';
import { PlannerSubagent } from './planner.js';
import { EditorSubagent } from './editor.js';
import { ReviewerSubagent } from './reviewer.js';
import { BrowserUseSubagent } from './browser-use.js';
import type { SubagentProgressEvent } from './types.js';

const parallelRoles = new Set<SubagentRole>(['file-picker', 'browser-use']);
let pipelineSequence = 0;
type PipelineTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked';

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

  async dispatch(task: SubagentTask, context?: Partial<SubagentContext>): Promise<SubagentResult> {
    const signal = context?.signal ?? this.ctx.signal;
    if (signal?.aborted) {
      return {
        success: false,
        output: '',
        error: 'Subagent execution cancelled',
      };
    }

    const agent = this.registry.get(task.role);
    if (!agent) {
      return {
        success: false,
        output: '',
        error: `No subagent registered for role: "${task.role}". Available: ${Array.from(this.registry.keys()).join(', ')}`,
      };
    }

    const runContext: SubagentContext = {
      ...this.ctx,
      ...context,
      signal,
    };

    if (!signal) {
      return agent.run(task, this.workingDirectory, runContext);
    }

    const runPromise = agent.run(task, this.workingDirectory, runContext);

    return new Promise<SubagentResult>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        resolve({
          success: false,
          output: '',
          error: 'Subagent execution cancelled',
        });
      };
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      runPromise
        .then((res) => {
          cleanup();
          if (signal.aborted) {
            resolve({
              success: false,
              output: '',
              error: 'Subagent execution cancelled',
            });
          } else {
            resolve(res);
          }
        })
        .catch((err) => {
          cleanup();
          if (signal.aborted) {
            resolve({
              success: false,
              output: '',
              error: 'Subagent execution cancelled',
            });
          } else {
            reject(err);
          }
        });
    });
  }

  async runPipeline(tasks: SubagentTask[], context?: Partial<SubagentContext>): Promise<SubagentResult[]> {
    const runContext = { ...context, signal: context?.signal ?? this.ctx.signal };
    const signal = runContext.signal;
    const ids = new Set<string>();
    for (const task of tasks) {
      if (!task.id.trim() || ids.has(task.id)) {
        return [{ success: false, output: '', error: `Pipeline task ids must be unique and non-empty: "${task.id}"` }];
      }
      ids.add(task.id);
    }
    for (const task of tasks) {
      const dependencies = task.dependsOn ?? [];
      const unknown = dependencies.find((id) => !ids.has(id));
      if (unknown) {
        return [{ success: false, output: '', error: `Task "${task.id}" depends on unknown task "${unknown}"` }];
      }
      if (dependencies.includes(task.id)) {
        return [{ success: false, output: '', error: `Task "${task.id}" cannot depend on itself` }];
      }
    }

    const runId = `pipeline_${Date.now()}_${++pipelineSequence}`;
    const states = new Map<string, PipelineTaskStatus>();
    for (const task of tasks) states.set(task.id, 'pending');
    const results = new Map<string, SubagentResult>();
    const emit = (task: SubagentTask, status: string, message: string): void => {
      const event: SubagentProgressEvent = {
        type: status === 'failed' || status === 'blocked' ? 'error' : status === 'done' ? 'done' : 'status',
        message,
        data: { taskId: task.id, role: task.role, status },
      };
      try {
        this.ctx.onProgress?.(event);
      } catch {
        // UI/log observers must not interrupt task execution.
      }
    };
    const persist = (task: SubagentTask, status: 'pending' | 'in_progress' | 'blocked' | 'done', message: string): void => {
      this.ctx.memory?.saveTask({
        id: `${runId}.${task.id}`,
        parentId: task.parentId ? `${runId}.${task.parentId}` : null,
        title: `@${task.role}: ${task.objective}`,
        status,
        progressLog: message,
      });
    };

    for (const task of tasks) {
      persist(task, 'pending', 'Waiting for dependencies.');
    }

    if (signal?.aborted) {
      for (const task of tasks) {
        states.set(task.id, 'blocked');
        const res = { success: false, output: '', error: 'Pipeline cancelled before start' };
        results.set(task.id, res);
        persist(task, 'blocked', res.error);
        emit(task, 'blocked', `${task.id} cancelled before start`);
      }
      return tasks.map((task) => ({
        ...results.get(task.id)!,
        metadata: { taskId: task.id, role: task.role, status: 'blocked' },
      }));
    }

    while ([...states.values()].some((status) => status === 'pending') && !signal?.aborted) {
      for (const task of tasks) {
        if (states.get(task.id) !== 'pending') continue;
        const dependencies = task.dependsOn ?? [];
        const failed = dependencies.find((id) => ['failed', 'blocked'].includes(states.get(id) ?? ''));
        if (failed) {
          const result = { success: false, output: '', error: `Skipped because dependency "${failed}" did not complete.` };
          states.set(task.id, 'blocked');
          results.set(task.id, result);
          persist(task, 'blocked', result.error!);
          emit(task, 'blocked', `${task.id} blocked by ${failed}`);
        }
      }

      if (signal?.aborted) break;

      const ready = tasks.filter((task) =>
        states.get(task.id) === 'pending' &&
        (task.dependsOn ?? []).every((id) => states.get(id) === 'done'),
      );
      if (ready.length === 0) {
        if ([...states.values()].some((status) => status === 'pending')) {
          for (const task of tasks) {
            if (states.get(task.id) !== 'pending') continue;
            const result = { success: false, output: '', error: 'Blocked by a dependency cycle or unresolved dependency.' };
            states.set(task.id, 'blocked');
            results.set(task.id, result);
            persist(task, 'blocked', result.error!);
            emit(task, 'blocked', `${task.id} blocked by unresolved dependencies`);
          }
        }
        break;
      }

      if (signal?.aborted) break;

      const first = ready[0]!;
      const batch = parallelRoles.has(first.role) && first.dependsOn !== undefined
        ? ready.filter((task) => parallelRoles.has(task.role) && task.dependsOn !== undefined).slice(0, 2)
        : [first];

      await Promise.all(batch.map(async (task) => {
        states.set(task.id, 'running');
        persist(task, 'in_progress', 'Subagent started.');
        emit(task, 'in_progress', `${task.id} started @${task.role}`);
        let result: SubagentResult;
        try {
          result = await this.dispatch(task, runContext);
        } catch (error) {
          result = { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
        }
        const status = signal?.aborted ? 'blocked' : result.success ? 'done' : 'failed';
        if (signal?.aborted && result.success) {
          result = { ...result, success: false, error: 'Subagent execution cancelled' };
        }
        states.set(task.id, status);
        results.set(task.id, result);
        persist(task, status === 'done' ? 'done' : 'blocked', result.success ? 'Subagent completed.' : result.error ?? 'Subagent failed.');
        emit(task, status, result.success ? `${task.id} completed @${task.role}` : `${task.id} ${status} @${task.role}: ${result.error ?? 'unknown error'}`);
      }));
    }

    if (signal?.aborted) {
      for (const task of tasks) {
        if (states.get(task.id) === 'pending') {
          const result = { success: false, output: '', error: 'Cancelled before this task started.' };
          states.set(task.id, 'blocked');
          results.set(task.id, result);
          persist(task, 'blocked', result.error);
          emit(task, 'blocked', `${task.id} cancelled before start`);
        }
      }
    }

    return tasks.map((task) => {
      const result = results.get(task.id) ?? {
        success: false,
        output: '',
        error: `Task "${task.id}" did not produce a result.`,
      };
      return {
        ...result,
        metadata: {
          ...result.metadata,
          taskId: task.id,
          role: task.role,
          status: states.get(task.id) ?? 'blocked',
        },
      };
    });
  }
}

