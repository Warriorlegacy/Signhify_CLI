import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SubagentOrchestrator } from '../orchestrator.js';
import type { ReviewVerdict } from '../types.js';
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

  it('planner tasks: >=1 child persisted with parentId "T1" (T3.2)', async () => {
    process.env.SIGNHIFY_MOCK_PROVIDER = '1'; // force the template path — hermetic
    const { MemoryStore } = await import('@signhify/memory');
    const store = new MemoryStore(path.join(tmpDir, 'memory.db'));
    const orchestratorWithMemory = new SubagentOrchestrator(tmpDir, {
      memory: store,
    });

    try {
      const res = await orchestratorWithMemory.dispatch({
        id: 'task-plan-1',
        role: 'planner',
        objective: 'ship the feature',
      });

      expect(res.success).toBe(true);
      const tasks = res.metadata?.tasks as Array<{ id: string; parentId?: string }>;
      expect(tasks.length).toBeGreaterThanOrEqual(2);
      expect(tasks.some(t => t.parentId === 'T1')).toBe(true);

      // And the same rows landed in the SQLite tasks table.
      const child = store.getTask('T1.1');
      expect(child?.parentId).toBe('T1');
      expect(store.getTask('T1')).not.toBeNull();
    } finally {
      delete process.env.SIGNHIFY_MOCK_PROVIDER;
      store.close();
    }
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

  describe('Closed-loop verification', () => {
    it('should execute closed-loop verifyStep on @Editor after write succeeds', async () => {
      const mockInvokeTool = vi.fn(async (name: string, payload: Record<string, unknown>) => {
        if (name === 'file-io') {
          return { content: JSON.stringify({ success: true, path: payload.path }) };
        }
        if (name === 'shell-exec') {
          return { content: JSON.stringify({ exitCode: 0, stdout: 'PASS src/app.test.ts (2 tests)' }) };
        }
        return { content: '{}' };
      });

      const res = await orchestrator.dispatch(
        {
          id: 'editor-task-1',
          role: 'editor',
          objective: 'implement feature',
          context: {
            targetFile: 'src/app.ts',
            content: 'export const run = () => true;',
            verifyStep: 'npm test -- --run',
          },
        },
        { invokeTool: mockInvokeTool },
      );

      expect(res.success).toBe(true);
      expect(res.artifacts).toContain('src/app.ts');
      expect(res.metadata?.verified).toBe(true);
      expect(res.metadata?.testCommand).toBe('npm test -- --run');
      expect(mockInvokeTool).toHaveBeenCalledWith('file-io', {
        action: 'write',
        path: 'src/app.ts',
        content: 'export const run = () => true;',
      });
      expect(mockInvokeTool).toHaveBeenCalledWith('shell-exec', {
        command: 'npm test -- --run',
        timeoutMs: 30000,
      });
    });

    it('should fail @Editor when verifyStep exits with non-zero exit code', async () => {
      const mockInvokeTool = vi.fn(async (name: string) => {
        if (name === 'file-io') {
          return { content: JSON.stringify({ success: true }) };
        }
        if (name === 'shell-exec') {
          return { content: JSON.stringify({ exitCode: 1, stderr: 'FAIL src/app.test.ts: expected true to be false' }) };
        }
        return { content: '{}' };
      });

      const res = await orchestrator.dispatch(
        {
          id: 'editor-task-2',
          role: 'editor',
          objective: 'implement broken feature',
          context: {
            targetFile: 'src/app.ts',
            content: 'export const run = () => false;',
            testCommand: 'npm test',
          },
        },
        { invokeTool: mockInvokeTool },
      );

      expect(res.success).toBe(false);
      expect(res.metadata?.verified).toBe(false);
      expect(res.metadata?.exitCode).toBe(1);
      expect(res.error).toContain('FAIL src/app.test.ts');
    });

    it('should execute testCommand and return structured ReviewVerdict on @Reviewer', async () => {
      const mockInvokeTool = vi.fn(async (name: string) => {
        if (name === 'shell-exec') {
          return { content: JSON.stringify({ exitCode: 0, stdout: 'Test suite passed: 5 tests' }) };
        }
        return { content: '{}' };
      });

      const res = await orchestrator.dispatch(
        {
          id: 'reviewer-task-1',
          role: 'reviewer',
          objective: 'verify test suite',
          context: {
            testCommand: 'npm test',
            instructions: 'Verify all unit tests pass',
          },
        },
        { invokeTool: mockInvokeTool },
      );

      expect(res.success).toBe(true);
      const verdict = res.metadata?.verdict as ReviewVerdict;
      expect(verdict).toBeDefined();
      expect(verdict.met).toBe(true);
      expect(verdict.exitCode).toBe(0);
      expect(res.output).toContain('@Reviewer verified');
    });

    it('should return failed ReviewVerdict with remaining steps when testCommand fails on @Reviewer', async () => {
      const mockInvokeTool = vi.fn(async (name: string) => {
        if (name === 'shell-exec') {
          return { content: JSON.stringify({ exitCode: 1, stderr: 'AssertionError: expected status 200 got 500' }) };
        }
        return { content: '{}' };
      });

      const res = await orchestrator.dispatch(
        {
          id: 'reviewer-task-2',
          role: 'reviewer',
          objective: 'verify test suite',
          context: {
            testCommand: 'npm test',
          },
        },
        { invokeTool: mockInvokeTool },
      );

      expect(res.success).toBe(false);
      const verdict = res.metadata?.verdict as ReviewVerdict;
      expect(verdict).toBeDefined();
      expect(verdict.met).toBe(false);
      expect(verdict.exitCode).toBe(1);
      expect(verdict.remainingSteps.length).toBeGreaterThan(0);
      expect(res.error).toContain('AssertionError');
    });

    it('should evaluate instructions with model adapter and return parsed ReviewVerdict', async () => {
      delete process.env.SIGNHIFY_MOCK_PROVIDER;
      const mockInvokeTool = vi.fn(async (name: string) => {
        if (name === 'shell-exec') {
          return { content: JSON.stringify({ exitCode: 0, stdout: 'Build successful' }) };
        }
        return { content: '{}' };
      });

      const streamChatSpy = vi.fn(async function* () {
        yield {
          type: 'text' as const,
          content: JSON.stringify({
            met: true,
            reason: 'All acceptance criteria and test assertions pass cleanly',
            remainingSteps: [],
          }),
        };
      });

      const mockAdapter = {
        vendor: 'openai' as const,
        streamChat: streamChatSpy,
      };

      const res = await orchestrator.dispatch(
        {
          id: 'reviewer-task-3',
          role: 'reviewer',
          objective: 'review PR requirements',
          context: {
            instructions: 'Ensure type safety and no errors',
            testCommand: 'npm run typecheck',
            diff: '+ export const isReady = true;',
          },
        },
        {
          invokeTool: mockInvokeTool,
          adapter: mockAdapter as any,
          model: 'test-model',
        },
      );

      expect(res.success).toBe(true);
      const verdict = res.metadata?.verdict as ReviewVerdict;
      expect(verdict).toBeDefined();
      expect(verdict.met).toBe(true);
      expect(verdict.reason).toBe('All acceptance criteria and test assertions pass cleanly');
      expect(streamChatSpy).toHaveBeenCalled();
    });

    it('should run a closed-loop Editor -> Reviewer pipeline with verification', async () => {
      const mockInvokeTool = vi.fn(async (name: string, payload: Record<string, unknown>) => {
        if (name === 'file-io') {
          return { content: JSON.stringify({ success: true, path: payload.path }) };
        }
        if (name === 'shell-exec') {
          return { content: JSON.stringify({ exitCode: 0, stdout: 'Tests: 12 passed' }) };
        }
        return { content: '{}' };
      });

      const pipeline = await orchestrator.runPipeline(
        [
          {
            id: 'edit-step',
            role: 'editor',
            objective: 'apply fix',
            context: {
              targetFile: 'src/fix.ts',
              content: 'export const fixed = true;',
              verifyStep: 'npm test',
            },
          },
          {
            id: 'review-step',
            role: 'reviewer',
            objective: 'verify fix',
            dependsOn: ['edit-step'],
            context: {
              testCommand: 'npm test',
              instructions: 'Verify fix passes tests',
            },
          },
        ],
        { invokeTool: mockInvokeTool },
      );

      expect(pipeline).toHaveLength(2);
      expect(pipeline[0].success).toBe(true);
      expect(pipeline[0].metadata?.verified).toBe(true);
      expect(pipeline[1].success).toBe(true);
      const verdict = pipeline[1].metadata?.verdict as ReviewVerdict;
      expect(verdict.met).toBe(true);
    });
  });

  describe('AbortSignal cancellation', () => {
    it('should immediately return cancelled result when dispatch called with pre-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const res = await orchestrator.dispatch(
        { id: 'task-cancel-1', role: 'file-picker', objective: 'find files' },
        { signal: controller.signal },
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/cancelled/i);
    });

    it('should cleanly abort running subagent when signal fires during execution', async () => {
      const controller = new AbortController();
      const mockInvokeTool = vi.fn(async () => {
        controller.abort();
        return new Promise<{ content: string }>((resolve) => {
          setTimeout(() => resolve({ content: JSON.stringify({ success: true }) }), 50);
        });
      });

      const res = await orchestrator.dispatch(
        {
          id: 'task-cancel-2',
          role: 'editor',
          objective: 'edit file',
          context: { targetFile: 'a.ts', content: 'b' },
        },
        { signal: controller.signal, invokeTool: mockInvokeTool },
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/cancelled/i);
    });

    it('should halt pipeline and block downstream tasks when cancelled mid-flight', async () => {
      const controller = new AbortController();
      const mockInvokeTool = vi.fn(async (name: string) => {
        if (name === 'file-io') {
          // Abort during first task
          controller.abort();
          return { content: JSON.stringify({ success: true }) };
        }
        return { content: '{}' };
      });

      const tasks = [
        {
          id: 'step-1',
          role: 'editor' as const,
          objective: 'edit initial file',
          context: { targetFile: 'file.ts', content: 'hello' },
        },
        {
          id: 'step-2',
          role: 'reviewer' as const,
          objective: 'review changes',
          dependsOn: ['step-1'],
        },
        {
          id: 'step-3',
          role: 'planner' as const,
          objective: 'plan next stage',
          dependsOn: ['step-2'],
        },
      ];

      const results = await orchestrator.runPipeline(tasks, {
        signal: controller.signal,
        invokeTool: mockInvokeTool,
      });

      expect(results).toHaveLength(3);
      // Downstream tasks should not have completed
      expect(results[1].success).toBe(false);
      expect(results[1].error).toMatch(/cancelled|Skipped|blocked/i);
      expect(results[2].success).toBe(false);
      expect(results[2].error).toMatch(/cancelled|Skipped|blocked/i);
    });

    it('should immediately block all pipeline tasks if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const tasks = [
        { id: 'p1', role: 'file-picker' as const, objective: 'find files' },
        { id: 'p2', role: 'planner' as const, objective: 'plan steps', dependsOn: ['p1'] },
      ];

      const results = await orchestrator.runPipeline(tasks, { signal: controller.signal });

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toMatch(/cancelled/i);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toMatch(/cancelled/i);
    });
  });
});

