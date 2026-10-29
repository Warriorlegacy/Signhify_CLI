import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '@signhify/memory';
import { formatSessionLine, runCli } from '../cli.js';
import * as interactiveModule from '../interactive.js';
import * as nonInteractiveModule from '../non-interactive.js';

vi.mock('../interactive.js', () => ({
  runInteractive: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../non-interactive.js', () => ({
  runNonInteractive: vi.fn().mockResolvedValue({ exitCode: 0, output: 'ok' }),
}));

describe('Sessions CLI & Resume Workflow', () => {
  let sandbox: string;
  let originalCwd: () => string;
  let originalExitCode: string | number | undefined;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'signhify-sessions-test-'));
    mkdirSync(join(sandbox, '.signhify'), { recursive: true });
    originalCwd = process.cwd;
    process.cwd = () => sandbox;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    process.exitCode = originalExitCode;
    rmSync(sandbox, { recursive: true, force: true });
  });

  describe('formatSessionLine', () => {
    it('formats a session with title and multiple checkpoints', () => {
      const line = formatSessionLine({
        id: 'sess_abc123',
        title: 'Feature Auth',
        createdAt: '2026-10-29 10:00:00',
        checkpointCount: 3,
      });
      expect(line).toBe('  sess_abc123 - "Feature Auth" [2026-10-29 10:00:00] (3 checkpoints)');
    });

    it('formats a session with 1 checkpoint using singular form', () => {
      const line = formatSessionLine({
        id: 'sess_single',
        title: 'Single CP',
        createdAt: '2026-10-29 11:00:00',
        checkpointCount: 1,
      });
      expect(line).toBe('  sess_single - "Single CP" [2026-10-29 11:00:00] (1 checkpoint)');
    });

    it('formats an untitled session with 0 checkpoints', () => {
      const line = formatSessionLine({
        id: 'sess_empty',
        createdAt: '2026-10-29 12:00:00',
        checkpointCount: 0,
      });
      expect(line).toBe('  sess_empty [2026-10-29 12:00:00] (0 checkpoints)');
    });
  });

  describe('sessions subcommand', () => {
    it('prints "No sessions found." when memory database has no sessions', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runCli(['sessions']);

      expect(logSpy).toHaveBeenCalledWith('No sessions found.');
      logSpy.mockRestore();
    });

    it('lists recent sessions with ID, title, timestamp, and checkpoint counts', async () => {
      const dbPath = join(sandbox, '.signhify', 'memory.db');
      const store = new MemoryStore(dbPath);
      const s1 = store.createSession(sandbox, 'sess_1', 'Main Development');
      const s2 = store.createSession(sandbox, 'sess_2', 'Bugfix Branch');

      store.saveCheckpoint(s1, 'Checkpoint 1 for main', 100);
      store.saveCheckpoint(s1, 'Checkpoint 2 for main', 250);
      store.saveCheckpoint(s2, 'Checkpoint 1 for bugfix', 150);
      store.close();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runCli(['sessions']);

      const logged = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(logged).toContain('Recent sessions:');
      expect(logged).toContain('sess_1 - "Main Development"');
      expect(logged).toContain('(2 checkpoints)');
      expect(logged).toContain('sess_2 - "Bugfix Branch"');
      expect(logged).toContain('(1 checkpoint)');

      logSpy.mockRestore();
    });

    it('outputs sessions as JSON with --json flag', async () => {
      const dbPath = join(sandbox, '.signhify', 'memory.db');
      const store = new MemoryStore(dbPath);
      const s1 = store.createSession(sandbox, 'sess_json_1', 'JSON Session');
      store.saveCheckpoint(s1, 'CP 1', 100);
      store.close();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runCli(['sessions', '--json']);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('sess_json_1');
      expect(parsed[0].title).toBe('JSON Session');
      expect(parsed[0].checkpointCount).toBe(1);

      logSpy.mockRestore();
    });

    it('respects --limit option', async () => {
      const dbPath = join(sandbox, '.signhify', 'memory.db');
      const store = new MemoryStore(dbPath);
      store.createSession(sandbox, 'sess_a', 'Session A');
      store.createSession(sandbox, 'sess_b', 'Session B');
      store.createSession(sandbox, 'sess_c', 'Session C');
      store.close();

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runCli(['sessions', '--limit', '2', '--json']);

      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(parsed).toHaveLength(2);

      logSpy.mockRestore();
    });
  });

  describe('resume workflow', () => {
    it('signhify resume <sessionId> launches interactive session with resume option', async () => {
      await runCli(['resume', 'sess_target_resume']);

      expect(interactiveModule.runInteractive).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(interactiveModule.runInteractive).mock.calls[0];
      expect(callArgs[1]).toEqual({ resume: 'sess_target_resume' });
    });

    it('signhify resume without sessionId reports an error and sets exitCode = 1', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runCli(['resume']);

      expect(interactiveModule.runInteractive).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Please provide a session ID to resume'),
      );
      expect(process.exitCode).toBe(1);

      errorSpy.mockRestore();
    });

    it('signhify run --resume <sessionId> without task launches interactive session with resume option', async () => {
      await runCli(['run', '--resume', 'sess_run_resume']);

      expect(interactiveModule.runInteractive).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(interactiveModule.runInteractive).mock.calls[0];
      expect(callArgs[1]).toEqual({ resume: 'sess_run_resume' });
    });

    it('signhify run <task> --resume <sessionId> passes resume option to non-interactive runner', async () => {
      await runCli(['run', 'refactor database layer', '--resume', 'sess_batch_resume']);

      expect(nonInteractiveModule.runNonInteractive).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(nonInteractiveModule.runNonInteractive).mock.calls[0];
      expect(callArgs[0]).toBe('refactor database layer');
      expect(callArgs[2]).toMatchObject({ resume: 'sess_batch_resume' });
    });

    it('signhify --resume <sessionId> on default command resumes interactive session', async () => {
      await runCli(['--resume', 'sess_default_resume']);

      expect(interactiveModule.runInteractive).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(interactiveModule.runInteractive).mock.calls[0];
      expect(callArgs[1]).toEqual({ resume: 'sess_default_resume' });
    });
  });

  describe('forking session workflow', () => {
    it('forks an existing session duplicating checkpoints for child session', () => {
      const dbPath = join(sandbox, '.signhify', 'memory.db');
      const store = new MemoryStore(dbPath);
      const parentId = store.createSession(sandbox, 'sess_parent_flow', 'Original Plan');
      store.saveCheckpoint(parentId, 'Checkpoint 1: Research', 100);
      store.saveCheckpoint(parentId, 'Checkpoint 2: Prototyping', 300);

      const forked = store.forkSession(parentId, undefined, 'Forked Plan');
      expect(forked.parentId).toBe(parentId);
      expect(forked.title).toBe('Forked Plan');
      expect(forked.checkpointCount).toBe(2);

      const parentCheckpoints = store.getAllCheckpointsBySession(parentId);
      const forkedCheckpoints = store.getAllCheckpointsBySession(forked.id);

      expect(parentCheckpoints).toHaveLength(2);
      expect(forkedCheckpoints).toHaveLength(2);
      expect(forkedCheckpoints[0].summary).toBe(parentCheckpoints[0].summary);
      expect(forkedCheckpoints[1].summary).toBe(parentCheckpoints[1].summary);

      store.close();
    });
  });
});
