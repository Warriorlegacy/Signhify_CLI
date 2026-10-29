import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubagentOrchestrator } from '../orchestrator.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('SubagentOrchestrator', () => {
  let tmpDir: string;
  let orchestrator: SubagentOrchestrator;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signhify-subagents-'));
    await fs.writeFile(path.join(tmpDir, 'auth-service.ts'), 'export const auth = true;');
    await fs.writeFile(path.join(tmpDir, 'payment.ts'), 'export const pay = true;');
    orchestrator = new SubagentOrchestrator(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should list all registered subagents', () => {
    const list = orchestrator.listSubagents();
    const roles = list.map(a => a.role);
    expect(roles).toContain('file-picker');
    expect(roles).toContain('planner');
    expect(roles).toContain('editor');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('browser-use');
  });

  it('should dispatch @FilePicker and discover matching files', async () => {
    const res = await orchestrator.dispatch({
      id: 'task-1',
      role: 'file-picker',
      objective: 'inspect auth service',
    });

    expect(res.success).toBe(true);
    expect(res.output).toContain('auth-service.ts');
  });

  it('should dispatch @Planner and return structured roadmap', async () => {
    const res = await orchestrator.dispatch({
      id: 'task-2',
      role: 'planner',
      objective: 'add stripe webhook',
    });

    expect(res.success).toBe(true);
    expect(res.output).toContain('@Planner');
    expect(res.output).toContain('T1');
  });

  it('should run a pipeline across multiple subagents', async () => {
    const pipeline = await orchestrator.runPipeline([
      { id: '1', role: 'file-picker', objective: 'find payment files' },
      { id: '2', role: 'planner', objective: 'refactor payment gateway' },
    ]);

    expect(pipeline).toHaveLength(2);
    expect(pipeline[0].success).toBe(true);
    expect(pipeline[1].success).toBe(true);
  });
});

