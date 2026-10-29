export type SubagentRole =
  | 'file-picker'
  | 'planner'
  | 'editor'
  | 'reviewer'
  | 'browser-use';

export interface SubagentTask {
  id: string;
  role: SubagentRole;
  objective: string;
  context?: Record<string, unknown>;
}

export interface SubagentResult {
  success: boolean;
  output: string;
  artifacts?: string[];
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Persistence seam for planner task trees; satisfied by MemoryStore.saveTask. */
export interface TaskPersister {
  saveTask(task: {
    id: string;
    parentId?: string | null;
    title: string;
    status?: 'pending' | 'in_progress' | 'blocked' | 'done';
  }): void;
}

/** Runtime handed to every subagent by the orchestrator. */
export interface SubagentContext {
  adapter?: import('@signhify/providers').ModelProviderAdapter;
  model?: string;
  memory?: TaskPersister;
}

export interface SubagentProgressEvent {
  type: 'status' | 'log' | 'diff' | 'error' | 'done';
  message: string;
  data?: unknown;
}

export interface Subagent {
  readonly role: SubagentRole;
  readonly name: string;
  readonly description: string;
  run(task: SubagentTask, cwd: string, ctx?: SubagentContext): Promise<SubagentResult>;
}

