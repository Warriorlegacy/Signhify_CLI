import { ToolHandler } from './tool-handler.js';
import { SubagentOrchestrator } from '@signhify/agents';
import type { SubagentRole } from '@signhify/agents';

let orchestrator: SubagentOrchestrator | null = null;

function getOrchestrator(workingDirectory: string): SubagentOrchestrator {
  if (!orchestrator) {
    orchestrator = new SubagentOrchestrator(workingDirectory);
  }
  return orchestrator;
}

export const subagentTool: ToolHandler = {
  name: 'subagent',
  description: 'Dispatch tasks to specialized subagents (file-picker, planner, editor, reviewer, browser-use)',
  parameters: {
    type: 'object',
    properties: {
      action: { 
        type: 'string', 
        enum: ['dispatch', 'list'], 
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
        const result = await orch.dispatch({
          id: `${role}-${Date.now()}`,
          role,
          objective: task,
          context: taskContext ? { note: taskContext } : undefined,
        });

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
