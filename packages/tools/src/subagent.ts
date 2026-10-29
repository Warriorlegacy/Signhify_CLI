import { ToolHandler } from './tool-handler.js';
import { SubagentOrchestrator } from '@signhify/agents';
import type { SubagentRole, SubagentContext, SubagentTask } from '@signhify/agents';

// Wired once by the CLI after the adapter and memory store exist; empty
// runtime keeps today's template-only behaviour for anything that never calls it.
let runtime: SubagentContext = {};
let orchestrator: SubagentOrchestrator | null = null;

export function configureSubagents(ctx: SubagentContext): void {
  runtime = ctx;
  orchestrator = null; // rebuild the cache so the new ctx is picked up
}

function getOrchestrator(workingDirectory: string): SubagentOrchestrator {
  if (!orchestrator) {
    orchestrator = new SubagentOrchestrator(workingDirectory, runtime);
  }
  return orchestrator;
}

export const subagentTool: ToolHandler = {
  name: 'subagent',
  description: 'Dispatch specialized subagents or run a bounded dependency-aware pipeline',
  parameters: {
    type: 'object',
    properties: {
      action: { 
        type: 'string', 
        enum: ['dispatch', 'list', 'pipeline'],
        description: 'The action to perform' 
      },
      role: { 
        type: 'string', 
        enum: ['file-picker', 'planner', 'editor', 'reviewer', 'browser-use'],
        description: 'The subagent role (required for dispatch)' 
      },
      task: { 
        type: 'string', 
        description: 'Task description (required for dispatch)' 
      },
      context: { 
        type: 'string', 
        description: 'Additional context for the task' 
      },
      testCommand: {
        type: 'string',
        description: 'Optional verification command for @Reviewer; executed through shell-exec permissions',
      },
      targetFile: {
        type: 'string',
        description: 'Workspace-relative destination for @Editor',
      },
      content: {
        type: 'string',
        description: 'Complete replacement content for targetFile; @Editor submits it through file-io review',
      },
      tasks: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        description: 'Pipeline tasks. Use dependsOn: [] only for work that is independent; only read-only roles can run concurrently.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            role: { type: 'string', enum: ['file-picker', 'planner', 'editor', 'reviewer', 'browser-use'] },
            task: { type: 'string' },
            dependsOn: { type: 'array', items: { type: 'string' }, description: 'Task ids that must finish first; use [] only when this work is independent' },
            parentId: { type: 'string' },
            context: { type: 'string' },
            testCommand: { type: 'string' },
            targetFile: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['id', 'role', 'task'],
        },
      },
    },
    required: ['action'],
  },

  async execute(args, context) {
    const action = args.action as string;
    const orch = getOrchestrator(context.workingDirectory);

    if (action === 'list') {
      const agents = orch.listSubagents();
      return JSON.stringify({ 
        subagents: agents,
        success: true 
      });
    }

    if (action === 'pipeline') {
      if (!Array.isArray(args.tasks) || args.tasks.length === 0 || args.tasks.length > 10) {
        return JSON.stringify({ error: 'pipeline requires between 1 and 10 tasks', success: false });
      }
      const tasks: SubagentTask[] = [];
      for (const raw of args.tasks) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return JSON.stringify({ error: 'each pipeline task must be an object', success: false });
        }
        const item = raw as Record<string, unknown>;
        const role = item.role as SubagentRole;
        const validRoles: SubagentRole[] = ['file-picker', 'planner', 'editor', 'reviewer', 'browser-use'];
        if (typeof item.id !== 'string' || !item.id.trim() || typeof item.task !== 'string' || !item.task.trim() || !validRoles.includes(role)) {
          return JSON.stringify({ error: 'each pipeline task needs a unique id, valid role, and non-empty task', success: false });
        }
        if (item.dependsOn !== undefined && (!Array.isArray(item.dependsOn) || item.dependsOn.some((id) => typeof id !== 'string'))) {
          return JSON.stringify({ error: `dependsOn for task "${item.id}" must be an array of task ids`, success: false });
        }
        const taskContext: Record<string, unknown> = {};
        if (typeof item.context === 'string') taskContext.note = item.context;
        if (typeof item.testCommand === 'string') taskContext.testCommand = item.testCommand;
        if (typeof item.targetFile === 'string') taskContext.targetFile = item.targetFile;
        if (typeof item.content === 'string') taskContext.content = item.content;
        tasks.push({
          id: item.id as string,
          role,
          objective: item.task as string,
          context: Object.keys(taskContext).length ? taskContext : undefined,
          dependsOn: item.dependsOn as string[] | undefined,
          parentId: typeof item.parentId === 'string' ? item.parentId : undefined,
        });
      }
      const results = await orch.runPipeline(tasks, { invokeTool: context.invokeTool, signal: context.signal });
      return JSON.stringify({ success: results.every((result: { success: boolean }) => result.success), results });
    }

    if (action === 'dispatch') {
      const role = args.role as SubagentRole;
      const task = args.task as string;
      const taskContext = args.context as string | undefined;

      if (!role || !task) {
        return JSON.stringify({ 
          error: 'role and task are required for dispatch action',
          success: false 
        });
      }

      try {
        const structuredContext: Record<string, unknown> = {};
        if (taskContext) structuredContext.note = taskContext;
        if (typeof args.testCommand === 'string') structuredContext.testCommand = args.testCommand;
        if (typeof args.targetFile === 'string') structuredContext.targetFile = args.targetFile;
        if (typeof args.content === 'string') structuredContext.content = args.content;
        const result = await orch.dispatch({
          id: `${role}-${Date.now()}`,
          role,
          objective: task,
          context: Object.keys(structuredContext).length > 0 ? structuredContext : undefined,
        }, { invokeTool: context.invokeTool, signal: context.signal });

        return JSON.stringify({
          success: result.success,
          output: result.output,
          error: result.error,
          artifacts: result.artifacts,
        });
      } catch (error) {
        return JSON.stringify({ 
          error: `Subagent execution failed: ${error instanceof Error ? error.message : String(error)}`,
          success: false 
        });
      }
    }

    return JSON.stringify({ error: `Unknown action: ${action}` });
  },
};
