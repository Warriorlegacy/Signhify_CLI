import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../memory-store.js';
import { CheckpointWriter } from '../checkpoint-writer.js';
import { MemoryMdManager } from '../memory-md.js';

describe('Memory checkpoint round-trip', () => {
  it('should write and read back a checkpoint', async () => {
    const dbPath = ':memory:';
    const store = new MemoryStore(dbPath);
    const writer = new CheckpointWriter(store, '/tmp/test-project');
    const memoryMd = new MemoryMdManager('/tmp/test-project');

    const checkpointPath = await writer.writeCheckpoint({
      sessionId: 'sess_test_123',
      summary: 'Initial scaffold complete',
      tokenUsage: 4500,
      decisions: ['Use TypeScript monorepo', 'SQLite + FTS5 for memory'],
      currentDiffs: [],
      openIssues: ['Wire up provider adapters'],
    });

    const readBack = await writer.readLatestCheckpoint();
    expect(readBack).not.toBeNull();
    expect(readBack!.summary).toBe('Initial scaffold complete');
    expect(readBack!.sections.decisions).toContain('Use TypeScript monorepo');
    expect(readBack!.sections.openIssues).toContain('Wire up provider adapters');

    await store.close();
  });

  it('should store and retrieve memory entries via FTS5', async () => {
    const dbPath = ':memory:';
    const store = new MemoryStore(dbPath);
    store.addEntry({ projectId: 'proj_1', category: 'decision', content: 'Use Ink for TUI', importance: 0.8 });
    store.addEntry({ projectId: 'proj_1', category: 'rule', content: 'All tool calls must go through permission engine', importance: 0.9 });

    const results = store.search('proj_1', 'permission');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('permission');

    store.close();
  });

  it('should write and read MEMORY.md via MemoryMdManager', async () => {
    const projectDir = '/tmp/test-signhify-memory';
    const manager = new MemoryMdManager(projectDir);
    await manager.writeMemoryMd('# Project Memory\n\n## Decisions\n- Use SQLite FTS5\n');
    await manager.appendEntry('Rules', 'Never commit .signhify/');
    const content = await manager.readMemoryMd();
    expect(content).toContain('Never commit .signhify/');
  });

  it('should write task progress files', async () => {
    const projectDir = '/tmp/test-signhify-tasks';
    const manager = new MemoryMdManager(projectDir);
    await manager.writeTaskProgress('T1', '# Task T1\n\n## In Progress\n2026-07-04\n');
    const content = await manager.readTaskProgress('T1');
    expect(content).toContain('Task T1');
    expect(content).toContain('In Progress');
  });
});
