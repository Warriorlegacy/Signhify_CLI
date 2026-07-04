import { describe, it, expect } from 'vitest';
import { PermissionEngine } from '../permission-engine.js';
import { ModeManager } from '../modes.js';

describe('PermissionEngine', () => {
  it('should allow tools in build mode', () => {
    const mm = new ModeManager();
    const pe = new PermissionEngine(mm);
    expect(pe.canUseTool('file-write').allowed).toBe(true);
    expect(pe.canUseTool('shell-exec').allowed).toBe(true);
  });

  it('should deny writes in plan mode', () => {
    const mm = new ModeManager();
    mm.setMode('plan');
    const pe = new PermissionEngine(mm);
    expect(pe.canWriteFile('/any/path').allowed).toBe(false);
  });

  it('should enforce shell denylist in auto mode', () => {
    const mm = new ModeManager();
    const pe = new PermissionEngine(mm, { shellDenylist: ['rm -rf *'] }, true);
    expect(pe.canExecuteShell('rm -rf *').allowed).toBe(false);
    expect(pe.canExecuteShell('npm test').allowed).toBe(true);
  });

  it('should enforce shell allowlist in auto mode', () => {
    const mm = new ModeManager();
    const pe = new PermissionEngine(mm, { shellAllowlist: ['npm test', 'npm run build'] }, true);
    expect(pe.canExecuteShell('npm test').allowed).toBe(true);
    expect(pe.canExecuteShell('rm -rf *').allowed).toBe(false);
  });
});
