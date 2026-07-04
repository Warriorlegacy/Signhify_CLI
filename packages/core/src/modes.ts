export type ModeName = 'build' | 'plan' | 'debug' | 'compose' | string;

export interface Mode {
  name: ModeName;
  description: string;
  prompt: string;
  allowedTools: string[];
  confirmBeforeToolUse: boolean;
}

export const BUILT_IN_MODES: Record<ModeName, Mode> = {
  build: {
    name: 'build',
    description: 'Full development mode — writes code, runs commands, full dev loop',
    prompt: 'You are a senior software engineer. Write code, run tests, fix issues, and verify your work.',
    allowedTools: ['file-read', 'file-write', 'shell-exec', 'git', 'search', 'browser'],
    confirmBeforeToolUse: false,
  },
  plan: {
    name: 'plan',
    description: 'Read-only exploration and architecture design',
    prompt: 'You are a software architect. Read and analyze the codebase. Propose designs without making any changes.',
    allowedTools: ['file-read', 'search'],
    confirmBeforeToolUse: false,
  },
  debug: {
    name: 'debug',
    description: 'Root-cause failing tests/errors, propose and apply fixes',
    prompt: 'You are a debugger. Find the root cause of errors, propose fixes, and apply them.',
    allowedTools: ['file-read', 'file-write', 'shell-exec', 'git', 'search'],
    confirmBeforeToolUse: false,
  },
  compose: {
    name: 'compose',
    description: 'Spec-driven orchestration of multi-step projects',
    prompt: 'You are a project orchestrator. Break tasks into subtasks, coordinate execution, and verify completion.',
    allowedTools: ['file-read', 'file-write', 'shell-exec', 'git', 'search', 'browser'],
    confirmBeforeToolUse: false,
  },
};

export class ModeManager {
  private modes: Map<string, Mode>;
  private currentMode: string;

  constructor(customModes?: Array<{ name: string; prompt: string; allowedTools: string[] }>) {
    this.modes = new Map(Object.entries(BUILT_IN_MODES));
    if (customModes) {
      for (const cm of customModes) {
        this.modes.set(cm.name, {
          name: cm.name,
          description: `Custom mode: ${cm.name}`,
          prompt: cm.prompt,
          allowedTools: cm.allowedTools,
          confirmBeforeToolUse: true,
        });
      }
    }
    this.currentMode = 'build';
  }

  getCurrentMode(): Mode {
    return this.modes.get(this.currentMode) ?? BUILT_IN_MODES.build;
  }

  setMode(name: string): void {
    if (!this.modes.has(name)) throw new Error(`Unknown mode: ${name}`);
    this.currentMode = name;
  }

  getAvailableModes(): string[] {
    return Array.from(this.modes.keys());
  }

  isToolAllowed(toolName: string, mode?: string): boolean {
    const m = mode ? this.modes.get(mode) : this.getCurrentMode();
    if (!m) return false;
    return m.allowedTools.includes(toolName) || m.allowedTools.includes('*');
  }
}
