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

export interface SubagentProgressEvent {
  type: 'status' | 'log' | 'diff' | 'error' | 'done';
  message: string;
  data?: unknown;
}

export interface Subagent {
  readonly role: SubagentRole;
  readonly name: string;
  readonly description: string;
  run(task: SubagentTask, cwd: string): Promise<SubagentResult>;
}

