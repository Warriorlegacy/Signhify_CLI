import { ModeManager } from './modes.js';
import { AutomationConfig } from './types.js';

export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
}

export class PermissionEngine {
  private modeManager: ModeManager;
  private automation?: AutomationConfig;
  private isAutoMode: boolean;

  constructor(modeManager: ModeManager, automation?: AutomationConfig, isAutoMode = false) {
    this.modeManager = modeManager;
    this.automation = automation;
    this.isAutoMode = isAutoMode;
  }

  canUseTool(toolName: string): PermissionCheck {
    const mode = this.modeManager.getCurrentMode();
    if (!mode.allowedTools.includes(toolName) && !mode.allowedTools.includes('*')) {
      return { allowed: false, reason: `Tool '${toolName}' is not allowed in ${mode.name} mode` };
    }
    return { allowed: true };
  }

  canExecuteShell(command: string): PermissionCheck {
    if (this.isAutoMode && this.automation) {
      if (this.automation.shellDenylist) {
        for (const pattern of this.automation.shellDenylist) {
          if (this.matchesPattern(command, pattern)) {
            return { allowed: false, reason: `Command matches denylist pattern: ${pattern}` };
          }
        }
      }
      if (this.automation.shellAllowlist && this.automation.shellAllowlist.length > 0) {
        for (const pattern of this.automation.shellAllowlist) {
          if (this.matchesPattern(command, pattern)) {
            return { allowed: true };
          }
        }
        return { allowed: false, reason: `Command not in shell allowlist` };
      }
    }
    return { allowed: true };
  }

  canWriteFile(filePath: string): PermissionCheck {
    const mode = this.modeManager.getCurrentMode();
    if (mode.name === 'plan') {
      return { allowed: false, reason: 'File writes are not allowed in plan mode' };
    }
    return { allowed: true };
  }

  setAutoMode(enabled: boolean): void {
    this.isAutoMode = enabled;
  }

  private matchesPattern(command: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(command);
  }
}
